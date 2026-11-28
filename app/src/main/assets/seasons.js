import { replaceMarkup } from './markup.js';
import { attachHints } from './guide.js';
import { waterFishRules } from './water-fish-rules.js';
import { bindWaterPicker, waterOption, waterPicker } from './water-picker.js';
import { localRuleWater } from './water-directory.js';
import { languageTag } from './i18n.js';
import * as Domain from './domain.js';
import {
  by,
  screen,
  t,
  loc,
  esc,
  selectField,
  button,
  icon,
  back,
  bindBack,
  bind,
  link,
  displayDay,
} from './ui.js';
/** Return the authority period for this water, species and fishing date, when monitored. */
function datedRule(water, species, day) {
  if (!Domain.validDay(day) || !water.risSince || day < water.risSince || !water.datedRules?.[species])
    return undefined;
  return water.datedRules[species].find((rule) => rule.from <= day && day <= rule.until) || null;
}

/** Show a size and date window only for a verified result on the selected section. */
export function localSeasonHtml(pack, w, section, speciesId, day) {
  const official = section === 'main' ? datedRule(w, speciesId, day) : undefined;
  let status = Domain.season(pack, speciesId, section, day);
  if (official !== undefined) status = official ? (official.closed ? 'closed' : 'outside') : 'unknown';
  const labels = {
    closed: t('seasons.closed_season'),
    outside: t('seasons.outside_the_listed_closed_season'),
    unknown: t('seasons.no_verified_rule_for_this_selection'),
    prohibited: t('seasons.fishing_is_prohibited_in_this_section'),
  };
  const glyph = {
    closed: 'calendar-off',
    prohibited: 'ban',
    unknown: 'circle-help',
    outside: 'calendar-days',
  }[status];
  const heading = `<strong>${icon(glyph)}${labels[status]}</strong>`;
  // An old selection may refer to a species that disappeared from the new atlas edition.
  if (status === 'unknown' || status === 'prohibited')
    return `<div class="panel result ${status}">${heading}</div>`;
  const windowLabel = official
    ? [official.from, official.until].map(displayDay).join(' – ')
    : pack.species[speciesId].window
        .map((d) =>
          new Intl.DateTimeFormat(languageTag, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          }).format(new Date('2000-' + d + 'T12:00Z')),
        )
        .join(' – ');
  const minCm = official ? official.minCm : w.size[speciesId];
  const minimum = minCm ? ' · ' + t('seasons.minimum_size') + ' ' + minCm + ' cm' : '';
  const maximum = official?.maxCm
    ? ' · ' + t('fish_catalogue.maximum_retained_size') + ' ' + official.maxCm + ' cm'
    : '';
  return `<div class="panel result ${status}">${heading}<p>${windowLabel}${minimum}${maximum}</p></div>`;
}

/** Refresh the local status, evidence period and available reminder action together. */
function ruleResult(pack, w) {
  const section = by('section').value,
    speciesId = by('species').value;
  const selectedDay = by('rule-date').value;
  replaceMarkup(by('status'), localSeasonHtml(pack, w, section, speciesId, selectedDay));
  const period = section === 'main' ? datedRule(w, speciesId, selectedDay) : undefined;
  by('rule-coverage').textContent = period
    ? [period.from, period.until].map(displayDay).join(' – ')
    : period === null
      ? t('seasons.no_verified_rule_for_this_selection')
      : t('seasons.checked') +
        ' ' +
        displayDay(pack.revision) +
        ' · ' +
        t('seasons.valid_through') +
        ' ' +
        displayDay(pack.until);
  const key = pack.id + '/' + w.id + '/' + speciesId;
  by('watch').replaceChildren();
  if (!window.Device || section !== 'main') return;
  const watching = Device.watching(key),
    today = Domain.today(pack.zone);
  const current = datedRule(w, speciesId, today);
  if (!watching && (current === null || (!current && (today > pack.until || today < pack.from)))) return;
  replaceMarkup(
    by('watch'),
    button(
      'watch-toggle',
      watching ? t('seasons.stop_reminders') : t('seasons.remind_me_of_season_changes'),
    ) +
      '<p class="meta">' +
      t('seasons.for_the_main_river_includes_a_reminder') +
      '</p>',
  );
  bind('watch-toggle', () => Device.reminder(key, !watching));
}
/** Resolve the current water and display the applicable seasonal rules and reminders.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function rulesScreen({ view, pack, nav, waterDirectory, hints }) {
  const { route } = view;
  const contextual = route.page === 'waterRules';
  const site =
    route.id === undefined && !route.country ? waterDirectory.waters[0] : waterDirectory.byId.get(route.id);
  const fixed = contextual && !route.country && site;
  const picker = fixed
    ? selectField('rule-water', t('common.water'), [[site.key, waterOption(site)]], site.key)
    : waterPicker('rule-water', t('common.water'), t('seasons.choose_water'), { suggestions: true });
  replaceMarkup(
    screen,
    (contextual ? back(route.country ? t('common.back') : site?.name || t('atlas.title')) : '') +
      `<div class="page-intro"><div class="title-mark">${icon('calendar-days')}</div><h1>${t('common.seasons_sizes')}</h1></div>
    <div class="columns"><section class="surface">${picker}<div id="rule-fields"></div></section>
    <div><div id="status" aria-live="polite"></div><div id="watch"></div></div></div><div id="rule-sources"></div>`,
  );
  if (contextual) bindBack(nav);
  let current;
  view.dispose = () => current?.dispose();
  /** Replace the lookup controls when the selected water or catalogue edition changes. */
  async function showWater(water) {
    if (current && route.id === (water?.id ?? null)) return;
    current?.dispose();
    if (route.id !== water?.id) {
      delete route.lookupClass;
      route.section = 'main';
    }
    route.id = water?.id ?? null;
    for (const id of ['rule-fields', 'status', 'watch', 'rule-sources']) by(id).replaceChildren();
    // A slow species catalog response must never repopulate the rules for an earlier search.
    const result = { route, active: () => view.active() && current === result, dispose: () => {} };
    current = result;
    if (!water) return;
    try {
      await showWaterRules(result, pack, nav, waterDirectory, water);
      if (result.active()) attachHints(by('rule-fields'), route.page, hints);
    } catch (error) {
      if (!result.active()) return;
      console.error('Could not load water rules', error);
      replaceMarkup(
        by('status'),
        '<p role="alert">' +
          esc(t('journal.could_not_open_this_screen')) +
          '</p>' +
          button('retry-rules', t('common.retry')),
      );
      bind('retry-rules', () => nav.show());
    }
  }
  if (fixed) {
    by('rule-water').disabled = true;
    await showWater(site);
  } else {
    by('rule-water-search').value = route.waterQuery || '';
    const selection = bindWaterPicker(
      'rule-water',
      view,
      waterDirectory,
      site?.key,
      route.country,
      (water, query) => {
        route.waterQuery = query;
        showWater(water);
      },
    );
    by('rule-water').onchange = () => {
      by('rule-water').focus({ preventScroll: true });
      showWater(selection());
    };
    await showWater(selection());
  }
}

/** Render details for the current lookup while leaving the search input and its caret in place. */
async function showWaterRules(view, pack, nav, waterDirectory, site) {
  const { route } = view;
  const w = localRuleWater(pack, site);
  const fishId =
    route.latin && Object.keys(pack.species).find((key) => pack.species[key].latin === route.latin);
  // Directory membership alone supplies no local size limit, closed season or reminder.
  if (!w || (route.latin && !fishId)) {
    if (site.country === 'CZ') return waterFishRules(view, nav, site);
    const authority = waterDirectory.countries[site.country]?.authority;
    replaceMarkup(
      by('status'),
      `<div class="panel result unknown"><strong>${icon('circle-help')}${t('seasons.no_verified_rule_for_this_selection')}
        </strong><div class="rulesrc">${link(site.source, t('waters.official_fishery_record'))}
        ${authority ? link(authority, t('waters.national_fishing_information')) : ''}</div></div>`,
    );
    if (waterDirectory.countries[site.country] && !route.latin) {
      replaceMarkup(by('rule-fields'), button('water-fish-rules', t('fish_rules.for_water'), 'secondary'));
      bind('water-fish-rules', () =>
        nav.open('fishCatalogue', {
          country: site.country,
          siteId: site.id,
          waterClass: typeof site.trout === 'boolean' ? (site.trout ? 'cztrout' : 'nontrout') : undefined,
        }),
      );
    }
    return;
  }
  const species = Object.entries(pack.species).map(([key, v]) => [key, loc(v)]);
  replaceMarkup(
    by('rule-fields'),
    `
    ${selectField(
      'section',
      t('seasons.section'),
      [
        ['main', t('seasons.main_river')],
        ['restricted', loc(w.restriction)],
        ['other', t('seasons.other_section_tributary')],
      ],
      route.section || 'main',
    )}
    <div class="pair"><div>
      ${selectField('species', t('common.fish_species'), species, route.species || fishId || species[0][0])}</div><div>
      <label for="rule-date">${t('seasons.fishing_date')}</label><input id="rule-date" type="date"
      value="${esc(route.day ?? Domain.today(pack.zone))}"></div></div>`,
  );
  replaceMarkup(
    by('rule-sources'),
    `<details class="fold"><summary>${icon('info')}${t('seasons.coverage_and_sources')}</summary><div class="fold-body"><p>
      ${t('seasons.the_selected_rule_covers_this_species_and')}</p><p class="sub" id="rule-coverage"></p>
      <div class="rulesrc">${link(w.source, t('seasons.fishery_authority'))}
      ${link(pack.law, t('seasons.national_closed_seasons'))}</div></div></details>`,
  );
  for (const key of ['section', 'species', 'rule-date'])
    by(key).onchange = () => {
      route.section = by('section').value;
      route.species = by('species').value;
      route.day = by('rule-date').value;
      ruleResult(pack, w);
    };
  /** Refresh the displayed rule when Android reports a change to the reminder. */
  const refresh = () => ruleResult(pack, w);
  window.addEventListener('reminderchange', refresh);
  view.dispose = () => window.removeEventListener('reminderchange', refresh);
  ruleResult(pack, w);
}
