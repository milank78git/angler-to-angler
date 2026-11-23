import { waterMap } from './waters.js';
import { Journal } from './journal.js';
import { today } from './domain.js';
import { rpc } from './profile-api.js';
import {
  back,
  bind,
  bindBack,
  button,
  by,
  confirmAction,
  cs,
  esc,
  loc,
  screen,
  selectField,
  submitChange,
  t,
  textInput,
  toast,
} from './ui.js';

const title = () => t('Aktivita na revíru', 'Water activity');
const unspecified = () => t('Neuvedeno', 'Unspecified');
const all = () => t('Všechny', 'All');
const fishLabel = () => t('Počet všech zapsaných ryb', 'Total recorded fish');
const targetLabel = () => t('Cílový druh výpravy', 'Trip target species');
const methodLabel = () => t('Hlavní způsob lovu', 'Main fishing method');
const mineLabel = () => t('Moje výpravy ve statistice', 'My activity contributions');
const monthLabel = (month) =>
  new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(month + 'T12:00:00Z'),
  );

function choices(pack) {
  return {
    targets: [
      ['unspecified', unspecified()],
      ...Object.entries(pack.species).map(([id, s]) => [id, loc(s)]),
      ['other', t('Jiný druh', 'Other species')],
    ],
    methods: [
      ['unspecified', unspecified()],
      ['float', t('Plavaná', 'Float fishing')],
      ['bottom', t('Položená nebo feeder', 'Bottom fishing or feeder')],
      ['lure', t('Přívlač', 'Lure fishing')],
      ['fly', t('Muškaření', 'Fly fishing')],
      ['other', t('Jiný způsob', 'Other method')],
    ],
  };
}

function problem(err) {
  if (err.status === 401 || err.status === 403)
    return t('Pro statistiku se znovu přihlas.', 'Sign in again to use water activity.');
  if (err.status === 409)
    return t('Příspěvek se změnil. Obnov zobrazení.', 'The contribution changed. Refresh the screen.');
  if (err.status === 422) return t('Zkontroluj období a počet ryb.', 'Check the period and fish count.');
  return t(
    'Služba je nedostupná. Zkontroluj připojení a zkus to znovu.',
    'Service unavailable. Check your connection and retry.',
  );
}

function failed(view, nav, err) {
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    title() +
    '</h1><p role="alert">' +
    problem(err) +
    '</p>' +
    button('activity-retry', t('Obnovit', 'Refresh'), 'secondary');
  bindBack(nav);
  bind('activity-retry', () => nav.show());
}

function entryText(entry, pack, options) {
  const water = pack.waters.find((w) => pack.country + ':' + w.id === entry.water);
  const label = (pairs, key) => pairs.find(([id]) => id === key)?.[1] || key;
  return [
    water?.name || entry.water,
    monthLabel(entry.month),
    targetLabel() + ' · ' + label(options.targets, entry.target),
    methodLabel() + ' · ' + label(options.methods, entry.method),
    fishLabel() + ' · ' + entry.fish,
  ].join(' / ');
}

async function withdraw(view, nav, item) {
  const accept = t('Odebrat ze statistiky', 'Withdraw from statistics');
  if (
    !(await confirmAction({
      title: accept + '?',
      message: t('Soukromý zápis zůstane v deníku.', 'Your private journal entry will be kept.'),
      accept,
      destructive: true,
    })) ||
    !view.active()
  )
    return;
  await submitChange(
    view,
    () => rpc('activity_change', { trip_id: item.entry.trip, expected_revision: item.revision }),
    () => nav.show(),
    (err) => (err.status === 409 ? failed(view, nav, err) : toast(problem(err))),
  );
}

/** Only the fields displayed in the confirmation are projected out of the local journal. */
export async function activityContribution({ view, nav, pack }) {
  const id = view.route.id;
  let trip, catches, state;
  try {
    [trip, catches, state] = await Promise.all([
      Journal.trip(id),
      Journal.catches(id),
      rpc('activity_state', { trip_id: id }),
    ]);
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const water = pack.waters.find((w) => w.id === trip?.waterId && trip.country === pack.country);
  const options = choices(pack);
  const allowed = water && trip.day >= '1900-01-01' && trip.day <= today(pack.zone);
  screen.innerHTML =
    back(t('Výprava', 'Trip')) +
    '<h1>' +
    t('Výprava ve statistice', 'Trip contribution') +
    '</h1>' +
    (state.entry
      ? '<section class="surface"><h2>' +
        t('Sdílené údaje', 'Shared details') +
        '</h2><p>' +
        esc(entryText(state.entry, pack, options)) +
        '</p>' +
        button('withdraw-activity', t('Odebrat ze statistiky', 'Withdraw from statistics'), 'danger') +
        '</section>'
      : '') +
    (allowed
      ? '<section class="surface"><h2>' +
        esc(water.name) +
        '</h2><p>' +
        esc(monthLabel(trip.day.slice(0, 7) + '-01')) +
        ' · ' +
        fishLabel() +
        ' · ' +
        catches.length +
        '</p>' +
        selectField('activity-target', targetLabel(), options.targets, state.entry?.target || 'unspecified') +
        selectField('activity-method', methodLabel(), options.methods, state.entry?.method || 'unspecified') +
        '<p>' +
        t(
          'Do souhrnu přispěješ za celý revír a měsíc. Přesný den, místo, poznámky a fotky zůstanou v deníku.',
          'Contribute for the entire water and month. Exact date, location, notes and photos stay in your journal.',
        ) +
        '</p>' +
        button(
          'activity-submit',
          state.entry
            ? t('Aktualizovat údaje', 'Update details')
            : t('Přispět do statistiky', 'Contribute to statistics'),
          'primary',
        ) +
        '</section>'
      : '<p>' +
        t(
          'Lze zařadit jen dokončenou výpravu na revíru z atlasu.',
          'Only completed trips on a catalog water can be included.',
        ) +
        '</p>');
  bindBack(nav);
  if (state.entry) bind('withdraw-activity', () => withdraw(view, nav, state));
  if (!allowed) return;
  bind('activity-submit', async () => {
    const entry = {
      month: trip.day.slice(0, 7) + '-01',
      water: pack.country + ':' + water.id,
      target: by('activity-target').value,
      method: by('activity-method').value,
      fish: catches.length,
    };
    if (
      !(await confirmAction({
        title: t('Zahrnout dokončenou výpravu?', 'Include this completed trip?'),
        message: entryText(entry, pack, options),
        accept: t('Potvrdit údaje', 'Confirm details'),
      })) ||
      !view.active()
    )
      return;
    await submitChange(
      view,
      () =>
        rpc('activity_change', {
          trip_id: id,
          expected_revision: state.revision,
          water_key: entry.water,
          month_start: entry.month,
          target_species: entry.target,
          fishing_method: entry.method,
          fish_count: entry.fish,
        }),
      () => {
        nav.show();
        toast(t('Příspěvek je uložený.', 'Contribution saved.'));
      },
      (err) => (err.status === 409 ? failed(view, nav, err) : toast(problem(err))),
    );
  });
}

/** Keep withdrawals reachable after a local trip is deleted or on a new phone. */
export async function myActivity({ view, nav, pack }) {
  let page;
  try {
    page = await rpc('activity_mine', { before_position: view.route.cursor || null });
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const options = choices(pack);
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    mineLabel() +
    '</h1>' +
    (page.items.length
      ? page.items
          .map(
            (item, i) =>
              '<article class="surface"><p>' +
              esc(entryText(item.entry, pack, options)) +
              '</p>' +
              button('withdraw-' + i, t('Odebrat ze statistiky', 'Withdraw from statistics'), 'secondary') +
              '</article>',
          )
          .join('')
      : '<p>' + t('Žádné další sdílené výpravy.', 'No more contributed trips.') + '</p>') +
    (page.next ? button('activity-older', t('Starší příspěvky', 'Older contributions'), 'secondary') : '');
  bindBack(nav);
  page.items.forEach((item, i) => bind('withdraw-' + i, () => withdraw(view, nav, item)));
  if (page.next) bind('activity-older', () => nav.open('myActivity', { cursor: page.next }));
}

/** All sample counts and suppression decisions come from the same server-side snapshot. */
export async function waterActivity({ view, nav, pack, rivers }) {
  const route = view.route;
  const water = pack.waters.find((w) => w.id === route.id);
  const options = choices(pack);
  let report;
  try {
    report = await rpc('activity_summary', {
      water_key: pack.country + ':' + water.id,
      month_start: route.month || null,
      target_species: route.target || null,
      fishing_method: route.method || null,
    });
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const sample = report.sample;
  const withAll = (rows) => [['', all()], ...rows];
  const metric = (label, value) => '<p>' + esc(label) + ' · <strong>' + esc(value) + '</strong></p>';
  screen.innerHTML =
    back(water.name) +
    '<h1>' +
    title() +
    '</h1><p>' +
    esc(water.name) +
    ' · ' +
    t('celý revír', 'entire water') +
    '</p>' +
    '<details class="fold"><summary>' +
    t('Rozsah souhrnu na mapě', 'Summary area on the map') +
    '</summary>' +
    waterMap(water, rivers, true) +
    '</details>' +
    '<form id="activity-filters" class="surface">' +
    textInput(
      'activity-month',
      t('Kalendářní měsíc', 'Calendar month'),
      report.month.slice(0, 7),
      'type="month" required min="1900-01" max="' + esc(report.latest.slice(0, 7)) + '"',
    ) +
    selectField('activity-target', targetLabel(), withAll(options.targets), route.target || '') +
    selectField('activity-method', methodLabel(), withAll(options.methods), route.method || '') +
    '<button class="secondary">' +
    t('Zobrazit období', 'Show period') +
    '</button></form>' +
    '<section class="surface" id="activity-result"><h2>' +
    esc(monthLabel(report.month)) +
    '</h2>' +
    (sample
      ? metric(t('Výpravy', 'Trips'), sample.trips) +
        metric(t('Různí rybáři', 'Distinct anglers'), sample.anglers) +
        metric(fishLabel(), sample.fish) +
        (sample.successfulTrips === null
          ? '<p>' +
            t(
              'Podíl úspěšných výprav se zobrazí, až vzorek zahrne i výpravu bez ryby.',
              'Success rate is shown when the sample also includes a blank trip.',
            ) +
            '</p>'
          : metric(
              t('Výpravy s alespoň jednou rybou', 'Trips with at least one fish'),
              sample.successfulTrips +
                ' / ' +
                sample.trips +
                ' (' +
                Math.round((100 * sample.successfulTrips) / sample.trips) +
                ' %)',
            ))
      : '<p>' +
        t(
          'Pro tento výběr není dost podkladů. Zkus celý revír bez filtrů, starší měsíc nebo se zeptej místních.',
          'Too little data for this selection. Try this water without filters, an earlier month, or ask local anglers.',
        ) +
        '</p>') +
    '</section><p class="meta">' +
    t(
      'Souhrn dobrovolně sdílených výprav se zpřístupní sedm dní po konci měsíce. Minimum je 10 výprav od 5 rybářů. Malé skupiny zůstávají skryté i při filtrování.',
      'Voluntary trip summaries are released seven days after month end. At least 10 trips from 5 anglers are required. Small groups stay hidden when filtering.',
    ) +
    '</p>' +
    button('activity-questions', t('Dotazy u revíru', 'Water questions'), 'secondary');
  bindBack(nav);
  by('activity-filters').onsubmit = (event) => {
    event.preventDefault();
    Object.assign(route, {
      month: by('activity-month').value + '-01',
      target: by('activity-target').value,
      method: by('activity-method').value,
    });
    nav.show();
  };
  bind('activity-questions', () => nav.open('waterDiscussion', { id: water.id }));
}
