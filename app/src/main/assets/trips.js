import { Journal, newJournalId } from './journal.js';
import * as Domain from './domain.js';
import {
  screen,
  cs,
  t,
  loc,
  esc,
  by,
  button,
  icon,
  bind,
  back,
  bindBack,
  emptyState,
  toast,
  displayDay,
  field,
  textInput,
  options,
  trackEdits,
  writeEntry,
} from './ui.js';
export async function listTrips({ view, nav }) {
  const trips = await Journal.listTrips();
  if (!view.active()) return;
  trips.sort((a, b) => b.day.localeCompare(a.day) || b.created - a.created);
  const total = trips.reduce((total, trip) => total + trip.catchCount, 0);
  screen.innerHTML = `<section class="journal-head"><div class="journal-art" aria-hidden="true">${icon('book-open')}</div>
    <h1>${t('Můj deník', 'My journal')}</h1><p>${icon('lock-keyhole')}${t('Soukromě v tomto telefonu', 'Private on this phone')}</p>
    <div class="metrics"><span><strong>${trips.length}</strong>${t('Výpravy', 'Trips')}</span><span><strong>${total}</strong>${t('Úlovky', 'Catches')}</span></div></section>
    <div class="list-heading"><h2>${t('Moje výpravy', 'My trips')}</h2>${button('add-trip', t('Nová výprava', 'New trip'), 'primary', 'plus')}</div>
    <div class="trip-list">${
      trips
        .map((trip) => {
          const d = new Date(trip.day + 'T12:00:00Z'),
            locale = cs ? 'cs-CZ' : 'en-GB',
            count = trip.catchCount;
          return `<button class="trip-row" data-trip="${esc(trip.id)}"><span class="date-stamp" aria-hidden="true"><strong>${d.getUTCDate()}</strong>${esc(d.toLocaleString(locale, { month: 'short', timeZone: 'UTC' }))}</span>
        <span class="row-main"><span class="number">${esc(displayDay(trip.day))}</span><strong>${esc(trip.waterName)}</strong><span class="sub">${t('Úlovky', 'Catches')} · ${count}${trip.notes ? ' · ' + esc(trip.notes.slice(0, 90)) : ''}</span></span>${icon('chevron-right')}</button>`;
        })
        .join('') ||
      emptyState(
        'notebook-pen',
        t('Zapiš první výpravu', 'Log your first trip'),
        t(
          'Zůstane v deníku, i když tentokrát nic nezabere.',
          'A day on the water belongs here even without a catch.',
        ),
      )
    }</div>`;
  bind('add-trip', () => nav.open('newTrip'));
  screen
    .querySelectorAll('[data-trip]')
    .forEach((b) => (b.onclick = () => nav.open('trip', { id: b.dataset.trip })));
}
export function tripForm({ view, nav, pack }) {
  const { route } = view;
  const selected = route.water || '';
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    `<div class="page-intro"><div class="title-mark">${icon('notebook-pen')}</div><h1>${t('Nová výprava', 'New trip')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${field('water', t('Revír nebo voda', 'Fishing water'), '<select id="water">' + options([['', t('Vlastní voda', 'Other water')], ...pack.waters.map((w) => [w.id, w.name])], selected) + '</select>')}
  <div id="custom">${textInput('water-name', t('Název vody', 'Water name'), '', 'maxlength="100"')}</div>
  ${textInput('day', t('Datum výpravy', 'Trip date'), Domain.today(selected ? pack.zone : undefined), 'type="date" required')}
  ${field('notes', t('Poznámky', 'Notes'), '<textarea id="notes" maxlength="4000" rows="3"></textarea>')}</section>
  <div class="savebar"><button class="primary">${icon('check')}${t('Uložit výpravu', 'Save trip')}</button></div></form>`;
  bindBack(nav);
  trackEdits(by('form'), view);
  function custom() {
    by('custom').hidden = !!by('water').value;
    by('water-name').required = !by('water').value;
  }
  by('water').onchange = custom;
  custom();
  const id = newJournalId(),
    created = Date.now();
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    const w = pack.waters.find((w) => w.id === by('water').value),
      name = w ? w.name : by('water-name').value.trim(),
      day = by('day').value;
    if (!name || !Domain.validDay(day)) {
      toast(t('Vyplň název vody a datum.', 'Enter a water name and a valid date.'));
      return;
    }
    await writeEntry(
      view,
      nav,
      id,
      () =>
        Journal.saveTrip({
          id,
          created,
          waterId: w ? w.id : null,
          packId: w ? pack.id : null,
          country: w ? pack.country : null,
          zone: w ? pack.zone : Intl.DateTimeFormat().resolvedOptions().timeZone,
          waterName: name,
          day,
          notes: by('notes').value.trim(),
        }),
      () => toast(t('Uložení selhalo. Zápis můžeš zkusit znovu.', 'Saving failed. You can retry.')),
    );
  };
}
export async function tripScreen({ view, nav, pack }) {
  const { id } = view.route;
  const [trip, catches] = await Promise.all([Journal.trip(id), Journal.catches(id)]);
  if (!view.active()) return;
  if (!trip) {
    nav.open('trips');
    return;
  }
  const images = [];
  view.dispose = () => images.forEach((url) => URL.revokeObjectURL(url));
  screen.innerHTML = `${back(t('Můj deník', 'My journal'))}
    <p class="meta">${displayDay(trip.day)}</p><h1>${esc(trip.waterName)}</h1>
    ${trip.notes ? `<p class="trip-note">${esc(trip.notes)}</p>` : ''}
    <div class="actions">${button('add', t('Přidat úlovek', 'Add catch'), 'primary', 'plus')}</div>
    <h2>${t('Úlovky', 'Catches')} · ${catches.length}</h2><div id="catch-list"></div>
    <div class="actions">${button('delete', t('Smazat výpravu', 'Delete trip'), 'danger')}</div>`;
  bindBack(nav);
  bind('add', () => nav.open('newCatch', { id }));
  bind('delete', async () => {
    if (
      !confirm(
        t(
          'Smazat tuto výpravu včetně úlovků, fotek a souřadnic?',
          'Delete this trip with all catches, photos and coordinates?',
        ),
      )
    )
      return;
    await writeEntry(
      view,
      nav,
      null,
      () => Journal.removeTrip(id),
      () => toast(t('Smazání selhalo.', 'Deletion failed.')),
    );
  });
  by('catch-list').innerHTML = catches.length
    ? ''
    : '<p class="empty">' + t('Zapsaná výprava bez úlovku.', 'A trip with no catches recorded.') + '</p>';
  for (const c of catches.sort((a, b) => a.created - b.created)) {
    const article = document.createElement('article');
    article.className = 'surface catch-card';
    by('catch-list').append(article);
    article.innerHTML = catchDetails(c, pack.species);
    if (c.hasPhoto) {
      const blob = await Journal.photo(c.id);
      if (!view.active()) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        images.push(url);
        const img = new Image();
        img.className = 'preview';
        img.alt = t('Fotografie úlovku', 'Catch photograph');
        img.src = url;
        article.prepend(img);
      }
    }
  }
}

/** Render user-entered notes and private positions from the stored catch snapshot. */
function catchDetails(record, species) {
  const name = species[record.speciesId]
    ? loc(species[record.speciesId])
    : record.speciesName || record.speciesId;
  const lines = [`<h3>${esc(name)}</h3>`];
  if (record.lengthMm) {
    const length = new Intl.NumberFormat(cs ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 }).format(
      record.lengthMm / 10,
    );
    lines.push(`<p>${length} cm · ${t('ruční zápis', 'manually entered')}</p>`);
  }
  if (record.bait) lines.push(`<p>${t('Nástraha', 'Bait')} · ${esc(record.bait)}</p>`);
  if (record.technique) lines.push(`<p>${t('Technika', 'Technique')} · ${esc(record.technique)}</p>`);
  if (record.position) {
    const { kind, lat, lon, source, accuracy } = record.position;
    const label =
      kind === 'strike' ? t('Místo záběru', 'Strike location') : t('Stanoviště rybáře', 'Angler position');
    const method = source === 'device' ? 'GPS' : t('ručně', 'manual');
    const precision = Number.isFinite(accuracy) ? ` ±${Math.round(accuracy)} m` : '';
    lines.push(
      `<p class="meta">${label} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${method}${precision}</p>`,
    );
  }
  return lines.join('');
}
