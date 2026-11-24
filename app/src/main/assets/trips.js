import { waterPicker, bindWaterPicker } from './water-picker.js';
import { localRuleWater, tripWater } from './water-directory.js';
import { languageTag } from './i18n.js';
import { addVerificationAction } from './verification.js';
import { Journal, newJournalId } from './journal.js';
import * as Domain from './domain.js';
import {
  screen,
  t,
  loc,
  esc,
  by,
  button,
  icon,
  bind,
  back,
  bindBack,
  confirmAction,
  emptyState,
  toast,
  displayDay,
  field,
  textInput,
  trackEdits,
  writeEntry,
} from './ui.js';
export async function listTrips({ view, nav }) {
  const trips = await Journal.listTrips();
  if (!view.active()) return;
  trips.sort((a, b) => b.day.localeCompare(a.day) || b.created - a.created);
  const total = trips.reduce((total, trip) => total + trip.catchCount, 0);
  screen.innerHTML = `<section class="journal-head"><div class="journal-art" aria-hidden="true">${icon('book-open')}</div>
    <h1>${t('trips.my_journal')}</h1><p>${icon('lock-keyhole')}${t('trips.private_on_this_phone')}</p>
    <div class="metrics"><span><strong>${trips.length}</strong>${t('common.trips')}</span><span><strong>${total}</strong>${t('trips.catches')}</span></div></section>
    <div class="list-heading"><h2>${t('trips.my_trips')}</h2>${button('add-trip', t('trips.new_trip'), 'primary', 'plus')}</div>
    <div class="trip-list">${
      trips
        .map((trip) => {
          const d = new Date(trip.day + 'T12:00:00Z'),
            locale = languageTag,
            count = trip.catchCount;
          return `<button class="trip-row" data-trip="${esc(trip.id)}"><span class="date-stamp" aria-hidden="true"><strong>${d.getUTCDate()}</strong>${esc(d.toLocaleString(locale, { month: 'short', timeZone: 'UTC' }))}</span>
        <span class="row-main"><span class="number">${esc(displayDay(trip.day))}</span><strong>${esc(trip.waterName)}</strong><span class="sub">${t('trips.catches')} · ${count}${trip.notes ? ' · ' + esc(trip.notes.slice(0, 90)) : ''}</span></span>${icon('chevron-right')}</button>`;
        })
        .join('') ||
      emptyState(
        'notebook-pen',
        t('trips.log_your_first_trip'),
        t('trips.a_day_on_the_water_belongs_here'),
      )
    }</div>`;
  bind('add-trip', () => nav.open('newTrip'));
  screen
    .querySelectorAll('[data-trip]')
    .forEach((b) => (b.onclick = () => nav.open('trip', { id: b.dataset.trip })));
}
export function tripForm({ view, nav, pack, waterDirectory }) {
  const { route } = view;
  const initialWater = waterDirectory.byId.get(route.water);
  screen.innerHTML =
    back(t('common.back')) +
    `<div class="page-intro"><div class="title-mark">${icon('notebook-pen')}</div><h1>${t('trips.new_trip')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${waterPicker('water', t('trips.fishing_water'), t('trips.other_water'))}
  <div id="custom">${textInput('water-name', t('trips.water_name'), '', 'maxlength="100"')}</div>
  ${textInput('day', t('common.trip_date'), Domain.today(initialWater?.zone), 'type="date" required')}
  ${field('notes', t('trips.notes'), '<textarea id="notes" maxlength="4000" rows="3"></textarea>')}</section>
  <div class="savebar"><button class="primary">${icon('check')}${t('trips.save_trip')}</button></div></form>`;
  bindBack(nav);
  const selectedWater = bindWaterPicker('water', view, waterDirectory, initialWater?.key);
  trackEdits(by('form'), view);
  function custom() {
    by('custom').hidden = !!by('water').value;
    by('water-name').required = !by('water').value;
  }
  let autoDay = by('day').value;
  by('day').oninput = () => { autoDay = null; };
  by('water').onchange = () => {
    custom();
    if (by('day').value === autoDay) by('day').value = autoDay = Domain.today(selectedWater()?.zone);
  };
  custom();
  const id = newJournalId(),
    created = Date.now();
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    const w = selectedWater(),
      name = w ? w.name : by('water-name').value.trim(),
      day = by('day').value;
    if (!name || !Domain.validDay(day)) {
      toast(t('trips.enter_a_water_name_and_a_valid'));
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
          packId: localRuleWater(pack, w) ? pack.id : null,
          country: w?.country ?? null,
          zone: w?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          waterName: name,
          day,
          notes: by('notes').value.trim(),
        }),
      () => toast(t('trips.saving_failed_you_can_retry')),
    );
  };
}
export async function tripScreen({ view, nav, pack, waterDirectory }) {
  const { id } = view.route;
  const [trip, catches] = await Promise.all([Journal.trip(id), Journal.catches(id)]);
  if (!view.active()) return;
  if (!trip) {
    nav.open('trips');
    return;
  }
  const images = [];
  view.dispose = () => images.forEach((url) => URL.revokeObjectURL(url));
  screen.innerHTML = `${back(t('trips.my_journal'))}
    <p class="meta">${displayDay(trip.day)}</p><h1>${esc(trip.waterName)}</h1>
    ${trip.notes ? `<p class="trip-note">${esc(trip.notes)}</p>` : ''}
    <div class="actions">${button('add', t('trips.add_catch'), 'primary', 'plus')}
      ${button('offer-technique', t('common.offer_a_technique'), 'secondary')}
      ${button('share-tip', t('common.share_a_trip_tip'), 'secondary')}${tripWater(waterDirectory, trip)
        ? button('trip-activity', t('common.trip_contribution'), 'secondary') : ''}</div>
    <h2>${t('trips.catches')} · ${catches.length}</h2><div id="catch-list"></div>
    <div class="actions">${button('delete', t('trips.delete_trip'), 'danger')}</div>`;
  bindBack(nav);
  bind('add', () => nav.open('newCatch', { id }));
  if (by('trip-activity')) bind('trip-activity', () => nav.open('activityContribution', { id }));
  bind('offer-technique', () => nav.open('marketEditor', { day: trip.day }));
  bind('share-tip', () => nav.open('shareCard', { tripId: id }));
  bind('delete', async () => {
    const confirmed = await confirmAction({
      title: t('trips.delete_trip_label'),
      message: t('trips.all_catches_photos_and_coordinates_for_this'),
      accept: t('trips.delete_trip'),
      destructive: true,
    });
    if (!confirmed) return;
    await writeEntry(
      view,
      nav,
      null,
      () => Journal.removeTrip(id),
      () => toast(t('trips.deletion_failed')),
    );
  });
  by('catch-list').innerHTML = catches.length
    ? ''
    : '<p class="empty">' + t('trips.a_trip_with_no_catches_recorded') + '</p>';
  for (const c of catches.sort((a, b) => a.created - b.created)) {
    const article = document.createElement('article');
    article.className = 'surface catch-card';
    by('catch-list').append(article);
    article.innerHTML = catchDetails(c, pack.species);
    const share = document.createElement('button');
    share.className = 'secondary';
    share.type = 'button';
    share.dataset.shareCatch = c.id;
    share.textContent = t('common.share_catch');
    share.onclick = () => nav.open('shareCard', { tripId: id, catchId: c.id });
    article.append(share);
    const publicCard = document.createElement('button');
    publicCard.type = 'button';
    publicCard.className = 'secondary';
    publicCard.dataset.publicCatch = c.id;
    publicCard.textContent = t('common.public_catch_card');
    publicCard.onclick = () => nav.open('publicCardEditor', { tripId: id, catchId: c.id });
    article.append(publicCard);
    addVerificationAction(article, c, trip, view, nav);
    if (c.hasPhoto) {
      const nominate = document.createElement('button');
      nominate.type = 'button';
      nominate.className = 'secondary';
      nominate.dataset.weeklyCatch = c.id;
      nominate.textContent = t('trips.enter_catch_of_the_week');
      nominate.onclick = () => nav.open('weeklyGroups', { tripId: id, catchId: c.id });
      article.append(nominate);
      const blob = await Journal.photo(c.id);
      if (!view.active()) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        images.push(url);
        const img = new Image();
        img.className = 'preview';
        img.alt = t('trips.catch.photograph');
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
    const length = new Intl.NumberFormat(languageTag, { maximumFractionDigits: 1 }).format(
      record.lengthMm / 10,
    );
    lines.push(`<p>${length} cm · ${t('trips.manually_entered')}</p>`);
  }
  if (record.bait) lines.push(`<p>${t('common.bait')} · ${esc(record.bait)}</p>`);
  if (record.technique) lines.push(`<p>${t('common.technique')} · ${esc(record.technique)}</p>`);
  if (record.position) {
    const { kind, lat, lon, source, accuracy } = record.position;
    const label =
      kind === 'strike' ? t('common.strike_location') : t('common.angler_position');
    const method = source === 'device' ? 'GPS' : t('trips.manual');
    const precision = Number.isFinite(accuracy) ? ` ±${Math.round(accuracy)} m` : '';
    lines.push(
      `<p class="meta">${label} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${method}${precision}</p>`,
    );
  }
  return lines.join('');
}
