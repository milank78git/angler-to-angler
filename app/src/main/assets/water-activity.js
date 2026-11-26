import { insertMarkup, replaceMarkup } from './markup.js';
import { activityTargetLabel, bindTargetPicker, targetFields } from './activity-target.js';
import { fishDirectory } from './fish-catalogue.js';
import { bindSharedSpecies } from './shared-species.js';
import { tripWater } from './water-directory.js';
import { languageTag } from './i18n.js';
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
  esc,
  screen,
  selectField,
  submitChange,
  t,
  textInput,
  toast,
} from './ui.js';

const title = () => t('common.water_activity');
const unspecified = () => t('water_activity.unspecified');
const all = () => t('common.all');
const fishLabel = () => t('water_activity.total_recorded_fish');
const targetLabel = () => t('water_activity.trip_target_species');
const methodLabel = () => t('water_activity.main_fishing_method');
const mineLabel = () => t('common.my_activity_contributions');
const monthLabel = (month) =>
  new Intl.DateTimeFormat(languageTag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(month + 'T12:00:00Z'),
  );

function methodChoices() {
  return [
    ['unspecified', unspecified()],
    ['float', t('water_activity.float_fishing')],
    ['bottom', t('water_activity.bottom_fishing_or_feeder')],
    ['lure', t('water_activity.lure_fishing')],
    ['fly', t('water_activity.fly_fishing')],
    ['other', t('water_activity.other_method')],
  ];
}

function problem(err) {
  if (err.status === 401 || err.status === 403)
    return t('water_activity.sign_in_again_to_use_water_activity');
  if (err.status === 409) return t('water_activity.the_contribution_changed_refresh_the_screen');
  if (err.status === 422) return t('water_activity.check_the_period_and_fish_count');
  return t('common.service_unavailable_check_your_connection_and_retry');
}

function failed(view, nav, err) {
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      title() +
      '</h1><p role="alert">' +
      problem(err) +
      '</p>' +
      button('activity-retry', t('common.refresh'), 'secondary'),
  );
  bindBack(nav);
  bind('activity-retry', () => nav.show());
}

function entryText(entry, directory, pack, fish, methods) {
  const water = directory.byKey.get(entry.water);
  const label = (pairs, key) => pairs.find(([id]) => id === key)?.[1] || key;
  return [
    water?.name || entry.water,
    monthLabel(entry.month),
    targetLabel() + ' · ' + activityTargetLabel(entry.target, pack, fish),
    methodLabel() + ' · ' + label(methods, entry.method),
    fishLabel() + ' · ' + entry.fish,
  ].join(' / ');
}

async function withdraw(view, nav, item) {
  const accept = t('water_activity.withdraw_from_statistics');
  if (
    !(await confirmAction({
      title: accept + '?',
      message: t('water_activity.your_private_journal_entry_will_be_kept'),
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
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function activityContribution({ view, nav, pack, waterDirectory }) {
  const id = view.route.id;
  let trip, catches, state, fish;
  try {
    [trip, catches, state, fish] = await Promise.all([
      Journal.trip(id),
      Journal.catches(id),
      rpc('activity_state', { trip_id: id }),
      fishDirectory(),
    ]);
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const water = tripWater(waterDirectory, trip);
  const methods = methodChoices();
  const allowed = water && trip.day >= '1900-01-01' && trip.day <= today(water.zone);
  replaceMarkup(
    screen,
    back(t('common.trip')) +
      '<h1>' +
      t('common.trip_contribution') +
      '</h1>' +
      (state.entry
        ? '<section class="surface"><h2>' +
          t('water_activity.shared_details') +
          '</h2><p>' +
          esc(entryText(state.entry, waterDirectory, pack, fish, methods)) +
          '</p>' +
          button('withdraw-activity', t('water_activity.withdraw_from_statistics'), 'danger') +
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
          targetFields(water.country) +
          selectField('activity-method', methodLabel(), methods, state.entry?.method || 'unspecified') +
          '<p>' +
          t('water_activity.contribute_for_the_entire_water_and_month') +
          '</p>' +
          button(
            'activity-submit',
            state.entry ? t('water_activity.update_details') : t('water_activity.contribute_to_statistics'),
            'primary',
          ) +
          '</section>'
        : '<p>' + t('water_activity.only_completed_trips_on_a_catalog_water') + '</p>'),
  );
  bindBack(nav);
  if (state.entry && water) {
    insertMarkup(
      screen,
      'beforeend',
      '<details id="species-share" class="fold"><summary>' +
        t('stats.publish_species') +
        '</summary><div class="fold-body"></div></details>',
    );
    bindSharedSpecies(by('species-share'), pack, trip, catches, state);
  }
  if (state.entry) bind('withdraw-activity', () => withdraw(view, nav, state));
  if (!allowed) return;
  bindTargetPicker(fish, pack, state.entry?.target || 'unspecified');
  bind('activity-submit', async () => {
    const entry = {
      month: trip.day.slice(0, 7) + '-01',
      water: water.key,
      target: by('activity-target').value,
      method: by('activity-method').value,
      fish: catches.length,
    };
    if (
      !(await confirmAction({
        title: t('water_activity.include_this_completed_trip'),
        message: entryText(entry, waterDirectory, pack, fish, methods),
        accept: t('water_activity.confirm_details'),
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
        toast(t('water_activity.contribution_saved'));
      },
      (err) => (err.status === 409 ? failed(view, nav, err) : toast(problem(err))),
    );
  });
}

/** Keep withdrawals reachable after a local trip is deleted or on a new phone. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function myActivity({ view, nav, pack, waterDirectory }) {
  let page, fish;
  try {
    [page, fish] = await Promise.all([
      rpc('activity_mine', { before_position: view.route.cursor || null }),
      fishDirectory().catch(() => null),
    ]);
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const methods = methodChoices();
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      mineLabel() +
      '</h1>' +
      (page.items.length
        ? page.items
            .map(
              (item, i) =>
                '<article class="surface"><p>' +
                esc(entryText(item.entry, waterDirectory, pack, fish, methods)) +
                '</p>' +
                button('withdraw-' + i, t('water_activity.withdraw_from_statistics'), 'secondary') +
                '</article>',
            )
            .join('')
        : '<p>' + t('water_activity.no_more_contributed_trips') + '</p>') +
      (page.next ? button('activity-older', t('water_activity.older_contributions'), 'secondary') : ''),
  );
  bindBack(nav);
  page.items.forEach((item, i) => bind('withdraw-' + i, () => withdraw(view, nav, item)));
  if (page.next) bind('activity-older', () => nav.open('myActivity', { cursor: page.next }));
}

/** All sample counts and suppression decisions come from the same server-side snapshot. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function waterActivity({ view, nav, pack, rivers, waterDirectory }) {
  const route = view.route;
  const water = waterDirectory.byId.get(route.id);
  if (!water) return nav.back();
  const methods = methodChoices();
  let report, fish;
  try {
    [report, fish] = await Promise.all([
      rpc('activity_summary', {
        water_key: water.key,
        month_start: route.month || null,
        target_species: route.target || null,
        fishing_method: route.method || null,
      }),
      fishDirectory(),
    ]);
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  const sample = report.sample;
  const withAll = (rows) => [['', all()], ...rows];
  const metric = (label, value) => '<p>' + esc(label) + ' · <strong>' + esc(value) + '</strong></p>';
  replaceMarkup(
    screen,
    back(water.name) +
      '<h1>' +
      title() +
      '</h1><p>' +
      esc(water.name) +
      ' · ' +
      t('water_activity.entire_water') +
      '</p>' +
      (rivers[water.id]
        ? '<details class="fold"><summary>' +
          t('water_activity.summary_area_on_the_map') +
          '</summary>' +
          waterMap(water, rivers, true) +
          '</details>'
        : '') +
      '<form id="activity-filters" class="surface">' +
      textInput(
        'activity-month',
        t('water_activity.calendar_month'),
        report.month.slice(0, 7),
        'type="month" required min="1900-01" max="' + esc(report.latest.slice(0, 7)) + '"',
      ) +
      targetFields(water.country) +
      selectField('activity-method', methodLabel(), withAll(methods), route.method || '') +
      '<button class="secondary">' +
      t('water_activity.show_period') +
      '</button></form>' +
      '<section class="surface" id="activity-result"><h2>' +
      esc(monthLabel(report.month)) +
      '</h2>' +
      (sample
        ? metric(t('common.trips'), sample.trips) +
          metric(t('water_activity.distinct_anglers'), sample.anglers) +
          metric(fishLabel(), sample.fish) +
          (sample.successfulTrips === null
            ? '<p>' + t('water_activity.success_rate_is_shown_when_the_sample') + '</p>'
            : metric(
                t('water_activity.trips_with_at_least_one_fish'),
                sample.successfulTrips +
                  ' / ' +
                  sample.trips +
                  ' (' +
                  Math.round((100 * sample.successfulTrips) / sample.trips) +
                  ' %)',
              ))
        : '<p>' + t('water_activity.too_little_data_for_this_selection_try') + '</p>') +
      '</section><p class="meta">' +
      esc(t('water_activity.voluntary_trip_summaries_are_released_seven_days')) +
      ' ' +
      esc(t('stats.independent_reviews')) +
      '</p>' +
      button('activity-questions', t('common.observations_and_questions'), 'secondary'),
  );
  bindBack(nav);
  bindTargetPicker(fish, pack, route.target || '', true);
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
