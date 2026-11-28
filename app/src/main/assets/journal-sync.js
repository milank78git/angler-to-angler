import { Journal } from './journal.js';
import { journalHistory, observeRevision, saveWithReceipt, sameParts as same } from './journal-history.js';
import {
  documentKeys,
  localDocument,
  uploadDocument,
  downloadDocument,
  prepareRestore,
} from './journal-transfer.js';
import { refreshPhotoLeases, bindExpirySummary } from './photo-retention.js';
import { rpc } from './profile-api.js';
import { t, confirmAction, displayDay } from './ui.js';
import { languageTag } from './i18n.js';

const restricted = window.Device?.groupSharingOnly?.();
const subject = restricted ? null : window.Device?.subjectId?.();
const prefix = 'journal.sync.v1.' + subject + '.';
/** Attach this subject's sync epoch to each journal operation. */
const call = (op, args) =>
  rpc('journal_sync', { op, args: { epoch: localStorage.getItem(prefix + 'epoch'), ...args } });
/** Send a photo operation through the same subject-scoped journal dispatcher. */
export const photoRequest = (op, args) => call(op, args);
/** Serialize reconciliation across open WebViews for this account. */
const syncLock = (work) => (navigator.locks ? navigator.locks.request(prefix + 'sync', work) : work());
/** Open the local receipt history for the current cloud generation. */
const historyForEpoch = () =>
  journalHistory(Journal, localStorage, subject, localStorage.getItem(prefix + 'epoch'));
const choiceKey = prefix + 'enabled';
let status = enabled() ? 'waiting' : 'disabled';
let checking = false;
let timer,
  busy = false,
  again = false,
  conflicts = [],
  deviceOnly = [];
const lastSyncKey = prefix + 'lastSuccess';
/** Treat an explicit offline signal as a reason to defer network work. */
function online() {
  return navigator.onLine !== false;
}
/** Publish the sync status to any currently mounted status panel. */
function notify(value) {
  status = value;
  window.dispatchEvent(new Event('journal-sync-status'));
}
/** Clear this account's cloud preferences and alarms while retaining its local journal. */
async function forgetCopy(keepEpoch = undefined) {
  localStorage.setItem(choiceKey, '0');
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key !== choiceKey && key?.startsWith(prefix)) localStorage.removeItem(key);
  }
  await Journal.clearSyncHistory(subject, keepEpoch);
  window.Device?.photoReminderDates?.('[]');
  conflicts = [];
  deviceOnly = [];
}
/** Require both an eligible device subject and an enabled account preference. */
function enabled() {
  return !!subject && localStorage.getItem(choiceKey) === '1';
}
/** Coalesce edits while preserving a follow-up run when a sync is already active. */
function schedule() {
  if (!enabled()) return;
  clearTimeout(timer);
  if (!online()) {
    notify('offline');
    return;
  }
  if (busy) {
    again = true;
    return;
  }
  notify('waiting');
  timer = setTimeout(() => run(), 700);
}
/** Reconcile local fingerprints and cloud revisions before committing restoration or upload results. */
async function run(resolution, retryRevision = true) {
  if (busy || !enabled()) return;
  clearTimeout(timer);
  if (!online()) {
    notify('offline');
    return;
  }
  busy = true;
  notify('working');
  let reread;
  try {
    reread = await syncLock(() => synchronize(resolution, retryRevision));
  } finally {
    busy = false;
    notify(status);
    if (again) {
      again = false;
      schedule();
    } else if (reread) await run(undefined, false);
  }
}
/** Reconcile each document against its cloud revision and pending local receipts. */
async function synchronize(resolution, retryRevision) {
  if (!enabled()) return;
  const detected = [],
    retained = [];
  let changed = false,
    uploaded = false,
    awaitingConversion = false,
    reread = false;
  try {
    const history = historyForEpoch();
    await history.migrate();
    if (localStorage.getItem(prefix + 'registered') !== '1') {
      await call('enable', {});
      localStorage.setItem(prefix + 'registered', '1');
    }
    const remote = new Map();
    let mediaSupported = false,
      mediaRevision;
    let after = '',
      floor;
    while (true) {
      const page = await call('list', { after, format: 2 });
      if (!after) mediaRevision = page.photoRevision;
      mediaSupported = page.photoFormat === 2;
      const { rows } = page;
      if (floor !== undefined && floor !== (page.floor || 0))
        throw Object.assign(Error('Journal changed'), { status: 409 });
      floor = page.floor || 0;
      if (!rows.length) break;
      for (const row of rows) remote.set(row.key, row);
      after = rows.at(-1).key;
    }
    const tracked = await history.keys();
    // Old servers removed the entire account on an age correction, sometimes with a null epoch.
    if (!remote.size && tracked.length && (await call('settings', {})).enabled === false)
      throw Object.assign(Error('Journal account removed'), { status: 410 });
    const keys = new Set([
      ...(await documentKeys(Journal, localStorage, subject)),
      ...remote.keys(),
      ...tracked,
    ]);
    for (const key of keys) {
      if (!enabled()) return;
      const row = remote.get(key) || { revision: 0, parts: [] };
      const tripMedia = mediaSupported && key.startsWith('trip/');
      if (tripMedia && row.format !== 2 && row.parts.length) {
        // Maintenance converts this revision independently. Other records can sync now.
        awaitingConversion = true;
        continue;
      }
      const detached = tripMedia;
      let state = (await history.get(key)) ?? { base: null, pending: [], held: false };
      /** Save this document’s reconciliation state in its own receipt. */
      const persist = (next) => history.put(key, next);
      const observed = await observeRevision(state, row, floor);
      if (observed.state !== state) {
        state = observed.state;
        await persist(state);
      }
      const base = state.base ?? [];
      const local = await Journal.lock(() =>
        localDocument(Journal, localStorage, subject, key, false, detached),
      );
      const favoriteEdit = prefix + 'added.' + key;
      const added = key.startsWith('pref/water/') && localStorage.getItem(favoriteEdit);
      /** Clear the uploaded favorite marker only if no newer edit replaced it. */
      function acknowledgeFavorite() {
        if (added && localStorage.getItem(favoriteEdit) === added) localStorage.removeItem(favoriteEdit);
      }
      const confirmed = { base: row.parts, pending: observed.inFlight, held: false };
      if (same(local.hashes, row.parts)) {
        if (
          !state.base ||
          !same(state.base, row.parts) ||
          state.held ||
          observed.inFlight.length !== state.pending.length
        )
          await persist(confirmed);
        acknowledgeFavorite();
        continue;
      }
      const choice =
        resolution?.key === key &&
        resolution.revision === row.revision &&
        resolution.floor === floor &&
        same(resolution.local, local.hashes)
          ? resolution.choice
          : '';
      const pref = key.startsWith('pref/');
      const uncertainDeletion =
        !row.parts.length &&
        (state.held ||
          (state.base === null &&
            (row.revision > 0 || (state.legacyFloor !== undefined && state.legacyFloor !== floor))) ||
          state.pending.some(
            (attempt) => attempt.parts.length && (row.revision > attempt.revision || floor !== attempt.floor),
          ));
      if (
        (!uncertainDeletion && same(base, row.parts)) ||
        choice === 'local' ||
        (pref && !row.parts.length && (added || !same(base, local.hashes)))
      ) {
        const upload = local.blocks
          ? local
          : await Journal.lock(() => localDocument(Journal, localStorage, subject, key, true, tripMedia));
        if (!same(local.hashes, upload.hashes)) {
          again = true;
          continue;
        }
        // Track an ambiguous save before sending it and advance the checkpoint after confirmation.
        await uploadDocument(call, key, upload, row.revision, floor, (args) =>
          saveWithReceipt(call, args, state, persist),
        );
        await persist({ base: upload.hashes, pending: [], held: false });
        acknowledgeFavorite();
        uploaded = true;
      } else if (
        (!uncertainDeletion && same(base, local.hashes)) ||
        (choice === 'cloud' && row.parts.length > 0)
      ) {
        const data = await downloadDocument(call, row.parts);
        // Fetch and check remote bytes before taking the device writer lock.
        const applyRestore = await prepareRestore(Journal, localStorage, subject, key, data, call);
        await Journal.lock(async () => {
          if (!enabled()) return;
          const latest = await localDocument(Journal, localStorage, subject, key, false, detached);
          if (!same(local.hashes, latest.hashes)) {
            again = true;
            return;
          }
          const receipt = pref ? undefined : history.receipt(key, confirmed);
          if ((await applyRestore(local, receipt)) === false) {
            again = true;
            return;
          }
          if (pref) await persist(confirmed);
          acknowledgeFavorite();
          changed = true;
        });
      } else {
        // A locally deleted trip can still be identified from its verified account copy.
        let trip;
        if (key.startsWith('trip/')) {
          trip = await Journal.trip(key.slice(5));
          if (!trip && row.parts.length) trip = (await downloadDocument(call, row.parts))?.trip;
        }
        const record = { key, revision: row.revision, floor, local: local.hashes, trip };
        if (row.parts.length) detected.push(record);
        else {
          // A deletion on another device must not silently republish the phone's surviving copy.
          // Remember it across restarts and advances of the global deletion floor.
          if (!state.held) await persist({ ...state, held: true });
          retained.push(record);
        }
      }
    }
    if (!enabled()) return;
    if (mediaSupported && enabled())
      await refreshPhotoLeases(call, subject, prefix, uploaded || changed ? null : mediaRevision);
    conflicts = detected;
    deviceOnly = retained;
    if (conflicts.length) notify('conflict');
    else if (!online()) notify('offline');
    else if (awaitingConversion) notify('waiting');
    else if (!again) {
      if (uploaded || changed || (!retained.length && !localStorage.getItem(lastSyncKey)))
        localStorage.setItem(lastSyncKey, String(Date.now()));
      notify(retained.length ? 'device_only' : 'done');
    }
  } catch (error) {
    if (enabled()) {
      if (error.status === 410) {
        await forgetCopy();
        notify('disabled');
      } else if (!online()) notify('offline');
      else if (error.status === 409 && retryRevision) reread = true;
      else if (error.status === 429) notify('limited');
      else if (error.status === 413) notify('full');
      else if (error.status === 401 || error.status === 403) notify('signin');
      else notify('failed');
    }
  } finally {
    if (changed) window.dispatchEvent(new Event('journal-restored'));
  }
  return reread;
}
/** Prefer the fishing date and water over an internal record identifier. */
function conflictLabel(conflict, waters) {
  const { key, trip } = conflict;
  if (key.startsWith('trip/')) {
    const fields = [];
    if (trip?.day && Number.isFinite(Date.parse(trip.day + 'T12:00:00Z'))) fields.push(displayDay(trip.day));
    if (trip?.waterName) fields.push(trip.waterName);
    if (trip?.waterNumber) fields.push(trip.waterNumber);
    return fields.join(' · ') || t('sync.trip');
  }
  if (key.startsWith('photo/')) {
    const id = key.slice(6);
    return t('water_photo.personal') + ' · ' + (waters?.byKey.get(id)?.name || id);
  }
  if (key.startsWith('pref/water/')) {
    const id = key.slice(11);
    return t('waters.favorites') + ' · ' + (waters?.byId.get(id.slice(id.indexOf('.') + 1))?.name || id);
  }
  if (key === 'pref/atlas.topographic') return t('atlas.topographic');
  if (key === 'pref/country' || key === 'pref/fish.country') return t('fish_catalogue.fishing_country');
  return t('settings.title');
}

/** Bind the detailed controls and publish their state to an optional compact summary.
 * @param {HTMLElement | null} panel
 * @param {import('../../../../types/screens.js').ScreenContext['waterDirectory']} [waters]
 * @param {(status: { state: string, label: string, notice: string, attention: boolean, available: boolean }) => void} [onStatus]
 * @returns {() => void} Release this view's status listener without stopping account synchronization.
 */
export function bindJournalSync(panel, waters, onStatus) {
  let disposed = false;
  /** Stop updating an exited screen while leaving the shared synchronization scheduler running. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('journal-sync-status', render);
  }
  if (panel && restricted) panel.textContent = t('age.local_journal');
  if (!panel || !subject) {
    onStatus?.({
      state: 'disabled',
      label: t(restricted ? 'age.local_journal' : 'sync.disabled'),
      notice: '',
      attention: false,
      available: false,
    });
    return dispose;
  }
  /** Refresh the sync panel from consent, pending conflicts and the most recent result. */
  function render() {
    if (disposed || !panel.isConnected) {
      dispose();
      return;
    }
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    const focusedAction = focused?.getAttribute('data-action');
    const actionIndex = focusedAction
      ? Array.from(panel.querySelectorAll('[data-action]'))
          .filter((element) => element.getAttribute('data-action') === focusedAction)
          .indexOf(focused)
      : -1;
    if (focused)
      queueMicrotask(() => {
        // A state refresh must not strand keyboard focus or override a later focus decision.
        if (disposed || !panel.isConnected || focused.isConnected || document.activeElement !== document.body)
          return;
        const disclosure = panel.closest('#journal-sync-details');
        const restored = Array.from(panel.querySelectorAll('button[data-action]')).filter(
          (element) => element.getAttribute('data-action') === focusedAction,
        )[actionIndex];
        const trigger = document.getElementById(disclosure?.getAttribute('aria-labelledby') || '');
        const target = disclosure?.hasAttribute('hidden') ? trigger : restored || trigger;
        if (target instanceof window.HTMLElement) target.focus();
      });
    panel.replaceChildren();
    const label = document.createElement('p');
    label.setAttribute('role', 'status');
    panel.dataset.state = status;
    const last = Number(localStorage.getItem(lastSyncKey));
    const stamp =
      last > 0 && Number.isFinite(new Date(last).getTime())
        ? new Intl.DateTimeFormat(languageTag, { dateStyle: 'short', timeStyle: 'short' }).format(last)
        : '';
    label.textContent =
      status === 'done' && stamp
        ? t('sync.saved_at').replace('{time}', stamp)
        : status === 'limited'
          ? t('limits.hourly')
          : t('sync.' + status);
    panel.append(label);
    if (enabled()) bindExpirySummary(panel, subject);
    const requiresAction =
      [
        'failed',
        'check_failed',
        'conflict',
        'device_only',
        'limited',
        'offline',
        'full',
        'signin',
        'erased',
      ].includes(status) ||
      (status === 'waiting' && deviceOnly.length > 0);
    const notice = requiresAction
      ? t(
          status === 'waiting'
            ? 'sync.device_only'
            : status === 'limited'
              ? 'limits.hourly'
              : 'sync.' + status,
        )
      : panel.querySelector('summary')?.textContent || '';
    // Keep failures and pending device-only decisions visible when the detailed controls are closed.
    onStatus?.({
      state: status,
      label: label.textContent,
      notice,
      attention: !!notice,
      available: true,
    });
    if (stamp && status !== 'done') {
      const previous = document.createElement('p');
      previous.className = 'meta';
      previous.textContent = t('sync.last_success').replace('{time}', stamp);
      panel.append(previous);
    }
    /** Create a localized sync recovery action that cannot submit an enclosing form. */
    const button = (labelKey, action) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'secondary';
      el.dataset.action = labelKey;
      el.textContent = t(labelKey);
      el.onclick = action;
      panel.append(el);
    };
    if (busy || checking) return;
    if (!enabled() && status === 'check_failed') button('sync.retry', start);
    if (!enabled() && status !== 'checking')
      button('sync.enable', async () => {
        if (
          await confirmAction({
            title: t('sync.enable'),
            message: t('sync.consent') + ' ' + t('retention.policy'),
            accept: t('sync.enable'),
          })
        ) {
          if (busy || checking) return;
          busy = true;
          notify('working');
          try {
            await syncLock(async () => {
              const { epoch, enabled: hasCopy } = await call('settings', {});
              if (hasCopy === false) await forgetCopy();
              else if ((epoch || null) !== localStorage.getItem(prefix + 'epoch'))
                await forgetCopy(epoch || '');
              await call('enable', { epoch: epoch || null, consent: true });
              if (epoch) localStorage.setItem(prefix + 'epoch', epoch);
              localStorage.setItem(prefix + 'registered', '1');
              localStorage.setItem(choiceKey, '1');
            });
          } catch {
            notify('failed');
          } finally {
            busy = false;
          }
          if (enabled()) schedule();
          else notify('failed');
        }
      });
    else if (enabled() && status !== 'working') {
      button('sync.retry', () => run());
      button('sync.pause', async () => {
        if (
          await confirmAction({
            title: t('sync.pause'),
            message: t('sync.pause_info'),
            accept: t('sync.pause'),
          })
        ) {
          clearTimeout(timer);
          localStorage.setItem(choiceKey, '0');
          conflicts = [];
          deviceOnly = [];
          notify('disabled');
        }
      });
    }
    if (enabled())
      button('sync.erase', async () => {
        if (
          !(await confirmAction({
            title: t('sync.erase'),
            message: t('sync.erase_info'),
            accept: t('sync.erase'),
            destructive: true,
          })) ||
          busy ||
          checking
        )
          return;
        clearTimeout(timer);
        busy = true;
        notify('working');
        try {
          await syncLock(async () => {
            await call('erase', {});
            await forgetCopy();
          });
          status = 'erased';
        } catch {
          status = 'failed';
        } finally {
          busy = false;
          notify(status);
        }
      });
    if (status !== 'conflict' && status !== 'device_only' && !(status === 'waiting' && deviceOnly.length))
      return;
    if (deviceOnly.length && status !== 'device_only') {
      const explanation = document.createElement('p');
      explanation.textContent = t('sync.device_only');
      panel.append(explanation);
    }
    /** Describe a document conflict using the local journal identity where available. */
    function entryName(record) {
      const name = document.createElement('p');
      name.textContent = conflictLabel(record, waters);
      panel.append(name);
    }
    for (const c of deviceOnly) {
      entryName(c);
      button('sync.upload_copy', () => run({ ...c, choice: 'local' }));
    }
    if (status !== 'conflict') return;
    for (const c of conflicts) {
      entryName(c);
      for (const choice of ['cloud', 'local'])
        button('sync.' + choice, async () => {
          if (
            await confirmAction({
              title: t('sync.' + choice),
              message: t('sync.replace'),
              accept: t('sync.' + choice),
              destructive: true,
            })
          )
            run({ ...c, choice });
        });
    }
  }
  window.addEventListener('journal-sync-status', render);
  render();
  return dispose;
}
window.addEventListener('offline', () => {
  if (enabled()) {
    clearTimeout(timer);
    notify('offline');
  }
});
window.addEventListener('journal-edited', schedule);

/** Resume reconciliation after the angler resolves a pending choice. */
function resume() {
  if (status === 'check_failed') start();
  else schedule();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resume();
});
/** A cloud-enabled account may restore automatically only into an empty private journal. */
async function start() {
  if (!subject || checking) return;
  const choice = localStorage.getItem(choiceKey);
  if (choice !== null) {
    if (enabled()) schedule();
    if (!enabled() || !online()) {
      // Upgrade paused and offline journals even when no network round will run.
      try {
        await syncLock(() => historyForEpoch().migrate());
      } catch {
        notify('failed');
      }
    }
    return;
  }
  checking = true;
  notify('checking');
  try {
    const settings = await call('settings', {});
    const canRestore = settings.enabled || (!settings.epoch && window.Device?.journalCloudDefault?.());
    if (canRestore) {
      // Use the journal writer lock so the empty check and local opt-in cannot straddle a trip edit.
      await Journal.lock(async () => {
        const keys = await documentKeys(Journal, localStorage, subject);
        if (localStorage.getItem(choiceKey) !== null) return;
        const hasHistory = keys.some(
          (key) => key.startsWith('trip/') || key.startsWith('photo/') || key.startsWith('pref/water/'),
        );
        if (!hasHistory && settings.epoch) localStorage.setItem(prefix + 'epoch', settings.epoch);
        localStorage.setItem(choiceKey, hasHistory ? '0' : '1');
      });
    }
    if (enabled()) schedule();
    else notify('disabled');
  } catch {
    if (localStorage.getItem(choiceKey) === null) notify('check_failed');
  } finally {
    checking = false;
    notify(status);
  }
}
window.addEventListener('online', start);
start();
setInterval(() => {
  if (!online() || document.hidden || busy) return;
  if (status === 'check_failed') start();
  else if (enabled() && status !== 'conflict') run();
}, 60000);
