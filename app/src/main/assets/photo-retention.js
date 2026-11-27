import { Journal } from './journal.js';
import { photoHash, restorePhoto, stagePhoto } from './journal-photos.js';
import { languageTag } from './i18n.js';
import { t, toast } from './ui.js';

const day = 86400000;
const prefixFor = (subject) => 'journal.sync.v1.' + subject + '.';
const leasesKey = (prefix) => prefix + 'photos';
const queueKey = (prefix) => prefix + 'photoRenewals';
const read = (key) => JSON.parse(localStorage.getItem(key) || '[]');
const samePhoto = (a, b) => a.trip === b.trip && a.id === b.id && a.hash === b.hash && a.cycle === b.cycle;
const signal = () => window.dispatchEvent(new Event('photo-leases'));
const live = (row) => row.active && Date.parse(row.expires) > Date.now();
const stamp = (iso) => new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium' }).format(new Date(iso));

/** Persist an intention with the server-issued generation, including when offline. */
function requestRenewal(subject, rows) {
  const prefix = prefixFor(subject);
  if (localStorage.getItem(prefix + 'enabled') !== '1') return;
  const pending = read(queueKey(prefix));
  for (const { trip, id, hash, cycle } of rows) {
    const item = { trip, id, hash, cycle };
    if (!pending.some((row) => samePhoto(row, item))) pending.push(item);
  }
  localStorage.setItem(queueKey(prefix), JSON.stringify(pending));
  signal();
  window.dispatchEvent(new Event('journal-edited'));
}
export async function refreshPhotoLeases(call, subject, prefix, revision) {
  const epoch = localStorage.getItem(prefix + 'epoch');
  const valid = () =>
    localStorage.getItem(prefix + 'enabled') === '1' && localStorage.getItem(prefix + 'epoch') === epoch;
  const pending = read(queueKey(prefix));
  if (!pending.length && revision && localStorage.getItem(prefix + 'photoRevision') === revision) return;
  for (const item of pending) {
    if (!valid()) return;
    await call('photo_renew', item);
    if (!valid()) return;
    localStorage.setItem(
      queueKey(prefix),
      JSON.stringify(read(queueKey(prefix)).filter((x) => !samePhoto(x, item))),
    );
  }
  const rows = [];
  let cursor = {},
    pageRevision;
  while (valid()) {
    const page = await call('photo_list', cursor);
    if (pageRevision && pageRevision !== page.revision)
      throw Object.assign(Error('Photos changed'), { status: 409 });
    pageRevision = page.revision;
    const photos = page.photos;
    rows.push(...photos);
    if (photos.length < 100) break;
    const { trip, id } = photos.at(-1);
    cursor = { trip, id };
  }
  if (!valid()) return;
  const stored = JSON.stringify(rows);
  if (localStorage.getItem(leasesKey(prefix)) !== stored) {
    localStorage.setItem(leasesKey(prefix), stored);
    signal();
  }
  const days = [...new Set(rows.filter(live).map((r) => r.expires.slice(0, 10)))];
  window.Device?.photoReminderDates?.(JSON.stringify(days));
  // An explicit re-upload on another device does not change the trip manifest.
  for (const row of rows.filter(live)) {
    const record = await Journal.catchById(row.id);
    if (
      !record ||
      record.hasPhoto ||
      record.cloudPhotoHash !== row.hash ||
      'trip/' + record.tripId !== row.trip
    )
      continue;
    const photo = await restorePhoto(call, row, null);
    if (photo && valid()) await Journal.installCloudPhoto(record, photo);
  }
  if (valid() && pageRevision) localStorage.setItem(prefix + 'photoRevision', pageRevision);
}
function action(text, onclick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = t(text);
  button.onclick = onclick;
  return button;
}
export function bindExpirySummary(panel, subject) {
  const prefix = prefixFor(subject);
  const due = read(leasesKey(prefix)).filter(
    (r) => live(r) && Date.parse(r.expires) - Date.now() <= 30 * day,
  );
  if (!due.length) return;
  const group = document.createElement('details');
  const title = document.createElement('summary');
  title.textContent = t('retention.due').replace('{count}', String(due.length));
  group.append(title);
  const selected = [];
  for (const row of due) {
    const label = document.createElement('label'),
      check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = true;
    selected.push([check, row]);
    const info = document.createTextNode(stamp(row.expires));
    label.append(check, info);
    group.append(label);
    Promise.all([Journal.catchById(row.id), Journal.trip(row.trip.slice(5))])
      .then(([record, trip]) => {
        info.textContent = [record?.speciesName, trip?.waterName, trip?.day, stamp(row.expires)]
          .filter(Boolean)
          .join(' · ');
      })
      .catch(() => {});
  }
  group.append(
    action('retention.renew', () =>
      requestRenewal(
        subject,
        selected.filter(([c]) => c.checked).map(([, r]) => r),
      ),
    ),
  );
  panel.append(group);
}

/** Preview rendering never renews a lease. Only opening the individual image or a button does. */
export function bindCatchPhoto(article, record, url, view, call) {
  const subject = window.Device?.groupSharingOnly?.() ? null : window.Device?.subjectId?.();
  const prefix = prefixFor(subject);
  const panel = document.createElement('div');
  article.prepend(panel);
  let disposed = false;
  const current = () =>
    subject &&
    localStorage.getItem(prefix + 'enabled') === '1' &&
    read(leasesKey(prefix)).find((row) => row.trip === 'trip/' + record.tripId && row.id === record.id);
  const refresh = () => {
    if (!view.active() || !panel.isConnected) {
      window.removeEventListener('photo-leases', refresh);
      return;
    }
    panel.replaceChildren();
    const row = current();
    if (url) {
      const img = new Image();
      img.className = 'preview';
      img.src = url;
      img.alt = t('trips.catch.photograph');
      const open = action('trips.catch.photograph', async () => {
        const dialog = document.createElement('dialog');
        const full = new Image();
        full.src = url;
        full.alt = img.alt;
        full.style.maxWidth = '100%';
        dialog.append(
          full,
          action('common.close', () => dialog.close()),
        );
        document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.showModal();
        if (row && live(row) && (await photoHash(await Journal.photo(record.id))) === row.hash)
          requestRenewal(subject, [row]);
      });
      open.replaceChildren(img);
      panel.append(open);
    }
    if (!row) return;
    const note = document.createElement('p');
    const pending = read(queueKey(prefix)).some((x) => samePhoto(row, x));
    note.textContent = pending
      ? t('retention.pending')
      : live(row)
        ? t('retention.until').replace('{date}', stamp(row.expires))
        : t(url ? 'retention.local' : 'retention.expired');
    panel.append(note);
    if (live(row)) panel.append(action('retention.renew', () => requestRenewal(subject, [row])));
    else if (url)
      panel.append(
        action('retention.reupload', async (event) => {
          event.currentTarget.disabled = true;
          try {
            const file = await Journal.photo(record.id);
            if (!file || (await photoHash(file)) !== row.hash) throw Error('Photo changed');
            await stagePhoto(call, row, file, 'photo_reupload');
            window.dispatchEvent(new Event('journal-edited'));
          } catch {
            toast(t('sync.failed'));
          }
          if (!disposed) refresh();
        }),
      );
  };
  refresh();
  window.addEventListener('photo-leases', refresh);
  const previous = view.dispose;
  view.dispose = () => {
    disposed = true;
    window.removeEventListener('photo-leases', refresh);
    previous?.();
  };
}
