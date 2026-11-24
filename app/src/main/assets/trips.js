import { catchLatin, catchRulesHtml } from './catch-species.js';
import { fishDirectory } from './fish-catalogue.js';
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
function tripRow(trip, number) {
  const date = new Date(trip.day + 'T12:00:00Z');
  return `<button class="trip-row" data-trip="${esc(trip.id)}"><span class="date-stamp" aria-hidden="true"><strong>${date.getUTCDate()}</strong>${esc(date.toLocaleString(languageTag, { month: 'short', timeZone: 'UTC' }))}</span>
    <span class="row-main"><span class="number">${esc(displayDay(trip.day))}</span><strong>${esc(trip.waterName)}${number ? ' · ' + esc(number) : ''}</strong><span class="sub">${t('trips.catches')} · ${trip.catchCount}${trip.notes ? ' · ' + esc(trip.notes.slice(0, 90)) : ''}</span></span>${icon('chevron-right')}</button>`;
}

/** Filter one offline journal snapshot without replacing the focused input or re-reading catches. */
export async function listTrips({ view, nav, waterDirectory }) {
  const trips = await Journal.listTrips();
  if (!view.active()) return;
  trips.sort((a, b) => b.day.localeCompare(a.day) || b.created - a.created);
  const total = trips.reduce((sum, trip) => sum + trip.catchCount, 0);
  screen.innerHTML = `<section class="journal-head"><div class="journal-art" aria-hidden="true">${icon('book-open')}</div>
    <h1>${t('trips.my_journal')}</h1><p>${icon('lock-keyhole')}${t('trips.private_on_this_phone')}</p>
    <div class="metrics"><span><strong>${trips.length}</strong>${t('common.trips')}</span><span><strong>${total}</strong>${t('trips.catches')}</span></div></section>
    <div class="list-heading"><h2>${t('trips.my_trips')}</h2>${button('add-trip', t('trips.new_trip'), 'primary', 'plus')}</div>
    ${button('trip-stats', t('stats.title'), 'secondary')}` +
    (trips.length ? textInput('trip-search', t('trips.find_by_water'), view.route.query, 'type="search"') +
      '<p id="trip-results" class="meta" role="status"></p><div id="trip-list" class="trip-list"></div>' :
      emptyState('notebook-pen', t('trips.log_your_first_trip'), t('trips.a_day_on_the_water_belongs_here')));
  bind('trip-stats', () => nav.open('journalStatistics'));
  bind('add-trip', () => nav.open('newTrip'));
  if (!trips.length) return;

  const search = by('trip-search'), list = by('trip-list');
  let rows;
  function render() {
    const query = Domain.fold(search.value);
    const visible = query ? rows.filter(row => row.terms.some(term => term.includes(query))) : rows;
    list.innerHTML = visible.map(row => tripRow(row.trip, row.number)).join('');
    by('trip-results').textContent = !query ? '' : visible.length
      ? t('trips.match_count').replace('{count}', visible.length) : t('trips.no_matching_trips');
  }
  view.refreshWaters = directory => {
    rows = trips.map(trip => {
      const water = tripWater(directory, trip);
      const number = trip.waterNumber || water?.number || water?.code;
      const terms = [trip.waterName, number, water?.name, water?.number, water?.code].filter(Boolean).map(Domain.fold);
      return { trip, number, terms };
    });
    render();
  };
  search.oninput = () => { view.route.query = search.value; render(); };
  list.onclick = event => {
    const row = event.target.closest('[data-trip]');
    if (row) nav.open('trip', { id: row.dataset.trip });
  };
  view.refreshWaters(waterDirectory);
}
export function tripForm({ view, nav, pack, waterDirectory }) {
  const { route } = view;
  const initialWater = waterDirectory.byId.get(route.water);
  screen.innerHTML =
    back(t('common.back')) +
    `<div class="page-intro"><div class="title-mark">${icon('notebook-pen')}</div><h1>${t('trips.new_trip')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${waterPicker('water', t('trips.fishing_water'), t('trips.other_water'), { suggestions: true })}
  ${button('use-water-name', t('trips.use_private_name'), 'secondary')}
  <div id="custom">${textInput('water-name', t('trips.water_name'), '', 'maxlength="100"')}</div>
  ${textInput('day', t('common.trip_date'), Domain.today(initialWater?.zone), 'type="date" required')}
  ${field('notes', t('trips.notes'), '<textarea id="notes" maxlength="4000" rows="3"></textarea>')}</section>
  <div class="savebar"><button class="primary">${icon('check')}${t('trips.save_trip')}</button></div></form>`;
  bindBack(nav);
  const selectedWater = bindWaterPicker('water', view, waterDirectory, initialWater?.key);
  trackEdits(by('form'), view);
  const search = by('water-search'), water = by('water'), customName = by('water-name');
  search.maxLength = customName.maxLength;
  function updateWaterFields() {
    const pending = !!search.value.trim();
    by('use-water-name').hidden = !pending;
    by('custom').hidden = pending || !!water.value;
    customName.required = !by('custom').hidden;
    search.setCustomValidity(pending ? t('trips.confirm_water') : '');
  }
  search.addEventListener('input', updateWaterFields);
  bind('use-water-name', () => {
    customName.value = search.value.trim();
    water.value = '';
    water.dispatchEvent(new Event('change', { bubbles: true }));
    customName.focus();
  });
  let autoDay = by('day').value;
  by('day').oninput = () => { autoDay = null; };
  water.onchange = () => {
    updateWaterFields();
    if (by('day').value === autoDay) by('day').value = autoDay = Domain.today(selectedWater()?.zone);
  };
  updateWaterFields();
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
          waterNumber: w?.number || w?.code || null,
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
  const water = tripWater(waterDirectory, trip);
  const fishes = catches.length ? await fishDirectory().catch(() => null) : null;
  if (!view.active()) return;
  const images = [];
  view.dispose = () => images.forEach((url) => URL.revokeObjectURL(url));
  screen.innerHTML = `${back(t('trips.my_journal'))}
    <p class="meta">${displayDay(trip.day)}</p><h1>${esc(trip.waterName)}</h1>
    ${trip.notes ? `<p class="trip-note">${esc(trip.notes)}</p>` : ''}
    <div class="actions">${button('add', t('trips.add_catch'), 'primary', 'plus')}
      ${water ? button('trip-rules', t('dated_rules.trip'), 'secondary', 'calendar-days') : ''}
      ${button('offer-technique', t('common.offer_a_technique'), 'secondary')}
      ${button('share-tip', t('common.share_a_trip_tip'), 'secondary')}${water
        ? button('trip-activity', t('common.trip_contribution'), 'secondary') : ''}</div>
    <h2>${t('trips.catches')} · ${catches.length}</h2><div id="catch-list"></div>
    <div class="actions">${button('delete', t('trips.delete_trip'), 'danger')}</div>`;
  bindBack(nav);
  bind('add', () => nav.open('newCatch', { id }));
  if (water) {
    bind('trip-rules', () => nav.open('waterRules', { id:water.id, day:trip.day }));
    bind('trip-activity', () => nav.open('activityContribution', { id }));
  }
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
    const latin = catchLatin(c, pack, fishes);
    const name = fishes?.names.get(latin)?.label || (pack.species[c.speciesId] ? loc(pack.species[c.speciesId]) : c.speciesName || c.speciesId);
    article.innerHTML = catchDetails(c, name);
    if (water) {
      const details = document.createElement('details');
      details.className = 'fold';
      const summary = document.createElement('summary');
      summary.textContent = t('catch_picker.rules');
      const body = document.createElement('div');
      body.className = 'fold-body';
      // Build only an opened card; a trip may contain many catches of the same species.
      details.ontoggle = () => {
        if (details.open && !body.hasChildNodes()) body.innerHTML = catchRulesHtml(pack, fishes, water, trip.day, latin);
      };
      details.append(summary, body);
      article.append(details);
    }
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
function catchDetails(record, name) {
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
