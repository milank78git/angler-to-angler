import { Journal } from './journal.js';
import {
  documentKeys,
  localDocument,
  uploadDocument,
  downloadDocument,
  restoreDocument,
} from './journal-transfer.js';
import { photoHash } from './journal-photos.js';
import { refreshPhotoLeases, bindExpirySummary } from './photo-retention.js';
import { rpc } from './profile-api.js';
import { t, confirmAction, displayDay } from './ui.js';
import { languageTag } from './i18n.js';

const restricted = window.Device?.groupSharingOnly?.();
const subject = restricted ? null : window.Device?.subjectId?.();
const prefix = 'journal.sync.v1.' + subject + '.';
const call = (op, args) =>
  rpc('journal_sync', { op, args: { epoch: localStorage.getItem(prefix + 'epoch'), ...args } });
export const photoRequest = (op, args) => call(op, args);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const choiceKey = prefix + 'enabled';
let status = enabled() ? 'waiting' : 'disabled';
let checking = false;
let timer,
  busy = false,
  again = false,
  conflicts = [];
const lastSyncKey = prefix + 'lastSuccess';
function online() {
  return navigator.onLine !== false;
}
function notify(value) {
  status = value;
  window.dispatchEvent(new Event('journal-sync-status'));
}
function forgetCopy() {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
  localStorage.setItem(choiceKey, '0');
  window.Device?.photoReminderDates?.('[]');
  conflicts = [];
}
function enabled() {
  return !!subject && localStorage.getItem(choiceKey) === '1';
}
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
async function run(resolution, retryRevision = true) {
  if (busy || !enabled()) return;
  clearTimeout(timer);
  if (!online()) {
    notify('offline');
    return;
  }
  busy = true;
  const detected = [];
  notify('working');
  let changed = false,
    uploaded = false,
    reread = false;
  try {
    if (localStorage.getItem(prefix + 'registered') !== '1') {
      await call('enable', {});
      localStorage.setItem(prefix + 'registered', '1');
    }
    const remote = new Map();
    let mediaSupported = false,
      mediaRevision;
    let after = '',
      floor;
    const lastFloor = Number(localStorage.getItem(prefix + 'deletionFloor') || 0);
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
    const keys = new Set([...(await documentKeys(Journal, localStorage, subject)), ...remote.keys()]);
    for (const key of keys) {
      if (!enabled()) return;
      const row = remote.get(key) || { revision: 0, parts: [] };
      const tripMedia = mediaSupported && key.startsWith('trip/');
      if (tripMedia && row.format !== 2 && row.parts.length) {
        await call('photo_convert', { key, revision: row.revision });
        again = true;
        continue;
      }
      const detached = tripMedia;
      const checkpoint = prefix + 'base.' + key;
      const saved = localStorage.getItem(checkpoint);
      let base = JSON.parse(saved || '[]');
      if (
        row.legacy &&
        saved &&
        !same(base, row.parts) &&
        (await photoHash(new Blob([base.join(',')]))) === row.legacy
      )
        base = row.parts;
      const local = await Journal.lock(() =>
        localDocument(Journal, localStorage, subject, key, false, detached),
      );
      if (same(local.hashes, row.parts)) {
        if (!same(base, row.parts)) localStorage.setItem(checkpoint, JSON.stringify(row.parts));
        continue;
      }
      const choice =
        resolution?.key === key &&
        resolution.revision === row.revision &&
        same(resolution.local, local.hashes)
          ? resolution.choice
          : '';
      const unknownDeletion =
        saved === null && !row.parts.length && (row.revision > 0 || floor !== lastFloor);
      if ((!unknownDeletion && same(base, row.parts)) || choice === 'local') {
        const upload = local.blocks
          ? local
          : await Journal.lock(() => localDocument(Journal, localStorage, subject, key, true, tripMedia));
        if (!same(local.hashes, upload.hashes)) {
          again = true;
          continue;
        }
        await uploadDocument(call, key, upload, row.revision, floor);
        uploaded = true;
        localStorage.setItem(checkpoint, JSON.stringify(upload.hashes));
      } else if (same(base, local.hashes) || choice === 'cloud') {
        const data = await downloadDocument(call, row.parts);
        await Journal.lock(async () => {
          if (!enabled()) return;
          const latest = await localDocument(Journal, localStorage, subject, key, false, detached);
          if (!same(local.hashes, latest.hashes)) {
            again = true;
            return;
          }
          await restoreDocument(Journal, localStorage, subject, key, data, call);
          localStorage.setItem(checkpoint, JSON.stringify(row.parts));
          changed = true;
        });
      } else {
        // A locally deleted trip can still be identified from its verified account copy.
        let trip;
        if (key.startsWith('trip/')) {
          trip = await Journal.trip(key.slice(5));
          if (!trip && row.parts.length) trip = (await downloadDocument(call, row.parts))?.trip;
        }
        detected.push({ key, revision: row.revision, local: local.hashes, trip });
      }
    }
    if (!enabled()) return;
    if (mediaSupported && enabled())
      await refreshPhotoLeases(call, subject, prefix, uploaded || changed ? null : mediaRevision);
    conflicts = detected;
    if (conflicts.length) notify('conflict');
    else if (!online()) notify('offline');
    else if (!again) {
      if (uploaded || changed || !localStorage.getItem(lastSyncKey))
        localStorage.setItem(lastSyncKey, String(Date.now()));
      localStorage.setItem(prefix + 'deletionFloor', String(floor));
      notify('done');
    }
  } catch (error) {
    if (enabled()) {
      if (error.status === 410) {
        forgetCopy();
        notify('disabled');
      } else if (!online()) notify('offline');
      else if (error.status === 409 && retryRevision) reread = true;
      else if (error.status === 413) notify('full');
      else if (error.status === 401 || error.status === 403) notify('signin');
      else notify('failed');
    }
  } finally {
    busy = false;
    notify(status);
    if (changed) window.dispatchEvent(new Event('journal-restored'));
    if (again) {
      again = false;
      schedule();
    } else if (reread) await run(undefined, false);
  }
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

export function bindJournalSync(panel, waters) {
  if (panel && restricted) panel.textContent = t('age.local_journal');
  if (!panel || !subject) return;
  function render() {
    if (!panel.isConnected) {
      window.removeEventListener('journal-sync-status', render);
      return;
    }
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
      status === 'done' && stamp ? t('sync.saved_at').replace('{time}', stamp) : t('sync.' + status);
    panel.append(label);
    if (enabled()) bindExpirySummary(panel, subject);
    if (stamp && status !== 'done') {
      const previous = document.createElement('p');
      previous.className = 'meta';
      previous.textContent = t('sync.last_success').replace('{time}', stamp);
      panel.append(previous);
    }
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
            const { epoch } = await call('settings', {});
            await call('enable', { epoch: epoch || null, consent: true });
            if (epoch && epoch !== localStorage.getItem(prefix + 'epoch')) forgetCopy();
            if (epoch) localStorage.setItem(prefix + 'epoch', epoch);
            localStorage.setItem(prefix + 'registered', '1');
            localStorage.setItem(choiceKey, '1');
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
          notify('disabled');
        }
      });
    }
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
      localStorage.setItem(choiceKey, '0');
      notify('working');
      try {
        const { epoch } = await call('settings', {});
        await call('erase', { epoch: epoch || null });
        forgetCopy();
        status = 'erased';
      } catch {
        status = 'failed';
      } finally {
        busy = false;
        notify(status);
      }
    });
    if (status !== 'conflict') return;
    for (const c of conflicts) {
      const name = document.createElement('p');
      name.textContent = conflictLabel(c, waters);
      panel.append(name);
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
}
window.addEventListener('offline', () => {
  if (enabled()) {
    clearTimeout(timer);
    notify('offline');
  }
});
window.addEventListener('journal-edited', schedule);

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
