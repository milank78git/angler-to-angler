import { replaceMarkup } from './markup.js';
import { countryAt, countryBorders } from './country-lookup.js';
import { forFishingDate, scopedFishRules } from './fish-rules.js';
import { language, languageTag } from './i18n.js';
import {
  by,
  screen,
  back,
  bindBack,
  bind,
  button,
  displayDay,
  esc,
  field,
  selectField,
  t,
  link,
  toast,
} from './ui.js';
import { fold, validDay } from './domain.js';

let cache, installedRules;

/** Invalidate the assembled species directory when a new rules edition is installed. */
export function setFishingRules(rules) {
  installedRules = rules;
  cache = null;
}
let requestId = 1000000;
/** Load a named fish catalogue resource and surface a missing edition. */
const json = async (name) => {
  const response = await fetch(name + '.json');
  if (!response.ok) throw Error(name);
  return response.json();
};

/** Scientific names are the shared market keys. Translated labels are presentation only. */
export function fishDirectory() {
  if (!cache)
    cache = Promise.all([
      json('europe-fish'),
      json('fish-names-en'),
      language === 'en' ? {} : json('fish-names-' + (language === 'no' ? 'nb' : language)).catch(() => ({})),
      installedRules || json('europe-rules'),
      json('europe-checklists'),
    ])
      .then(([data, english, local, rules, checklists]) => {
        const names = new Map();
        for (const fish of data.species) {
          const common = local[fish.latin] || english[fish.latin];
          fish.label = common
            ? common.replace(/^\p{Ll}/u, (letter) =>
                letter.toLocaleUpperCase(local[fish.latin] ? languageTag : 'en'),
              )
            : fish.latin;
          fish.search = fold(
            [fish.latin, fish.label, english[fish.latin], ...(fish.aliases || [])].filter(Boolean).join(' '),
          );
          names.set(fish.latin, fish);
        }
        return { ...data, names, rules, checklists };
      })
      .catch((error) => {
        cache = null;
        throw error;
      });
  return cache;
}

/** Ask the selected locale for the region name and retain the country code as fallback. */
export function countryName(code) {
  try {
    return new Intl.DisplayNames([languageTag], { type: 'region' }).of(code);
  } catch {
    return code;
  }
}
/** Show the scientific name once when the display name already matches it. */
export const fishOption = (fish) =>
  fish.label === fish.latin ? fish.latin : fish.label + ' · ' + fish.latin;

/** Resolve a catalogue entry's translation key using the current dictionary. */
const words = (entry) => t(entry.message);
/** Label the catalogue scope that includes all European entries. */
const fullList = () => t('fish_catalogue.all_of_europe');
/** Use the same translated title when linking to or opening the fish catalogue. */
const catalogue = () => t('fish_catalogue.title');

/** Both pickers use one persisted country and the same searchable species list. */
export function preferredCountry(data) {
  const code = localStorage.getItem('fish.country');
  return data.countries.includes(code) ? code : '';
}

/** Sort region labels in the app language while preserving their stable country codes. */
export function countryOptions(data) {
  const countries = data.countries.map((code) => [code, countryName(code)]);
  countries.sort((a, b) => a[1].localeCompare(b[1], languageTag));
  return [['', fullList()], ...countries];
}

/** Filter against the requested country and normalized names before locale-aware sorting. */
export function matchingSpecies(data, country, query) {
  const term = fold(query.trim());
  return data.species
    .filter((fish) => (!country || fish.countries.includes(country)) && fish.search.includes(term))
    .sort((a, b) => a.label.localeCompare(b.label, languageTag));
}

/** List only current, sourced size limits with their geographic scope. */
function listedSizes(rules, country, waterClass) {
  const result = new Map(),
    day = new Date().toISOString().slice(0, 10);
  for (const r of rules.entries) {
    if (
      r.country !== country ||
      (r.validFrom && day < r.validFrom) ||
      (r.validUntil && day > r.validUntil) ||
      day > rules.sources[r.source].reviewBy
    )
      continue;
    if (country === 'CZ' && waterClass && r.scope !== 'czall' && r.scope !== waterClass) continue;
    const size = sizeTerms(r).join(' · ');
    if (!size) continue;
    for (const name of r.species) {
      const values = result.get(name) || new Set();
      values.add(size + ' · ' + words(rules.scopes[r.scope]));
      result.set(name, values);
    }
  }
  return result;
}

/** Distinguish strict lower bounds, inclusive minimums and maximum retained sizes. */
export function sizeTerms(rule) {
  return [
    rule.overCm != null && t('fish_catalogue.length_must_exceed') + ' ' + rule.overCm + ' cm',
    rule.minCm != null && t('fish_catalogue.minimum_size') + ' · ' + rule.minCm + ' cm',
    rule.maxCm != null && t('fish_catalogue.maximum_retained_size') + ' · ' + rule.maxCm + ' cm',
  ].filter(Boolean);
}

/** GPS only suggests a country after a tap. No coordinates leave the phone or enter the catalogue. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function fishCatalogue({ view, nav }) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const route = view.route;
  route.country ??= preferredCountry(data);
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      catalogue() +
      '</h1>' +
      selectField('fish-country', t('fish_catalogue.fishing_country'), countryOptions(data), route.country) +
      button('fish-gps', t('fish_catalogue.find_country_using_location'), 'secondary') +
      field('fish-query', t('fish_catalogue.find_a_species'), '<input type="search" id="fish-query">') +
      '<p id="fish-count" role="status"></p><div class="water-list" id="fish-results"></div>' +
      button('more-fish', t('fish_catalogue.more_species'), 'secondary'),
  );
  bindBack(nav);
  const query = by('fish-query');
  query.value = route.query || '';
  /** Refresh the paginated species list and its count for the current filter. */
  function render() {
    const matched = matchingSpecies(data, route.country, query.value);
    by('fish-count').textContent =
      t('fish_catalogue.species_count') +
      ' · ' +
      matched.length +
      (route.country ? ' · ' + t('fish_catalogue.documented_occurrences_choose_all_of_europe_for') : '');
    if (!route.country) by('fish-count').textContent += ' · ' + t('fish_rules.choose_country');
    const sizes = listedSizes(data.rules, route.country, route.waterClass);
    const shown = matched.slice(0, route.limit || 50);
    by('fish-results').replaceChildren(
      ...shown.map((fish) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'secondary';
        b.textContent = fishOption(fish);
        if (route.country) {
          const hint = document.createElement('small');
          hint.textContent = [...(sizes.get(fish.latin) || [t('fish_rules.check_size')])].join(' / ');
          b.classList.add('fish-list-item');
          b.append(hint);
        }
        b.onclick = () =>
          nav.open('fishDetail', {
            latin: fish.latin,
            country: route.country,
            siteId: route.siteId,
            waterClass: route.waterClass,
            day: route.day,
          });
        return b;
      }),
    );
    by('more-fish').hidden = shown.length >= matched.length;
  }
  /** Apply the selected country to the active catalogue query. */
  function selectCountry(code) {
    if (route.country !== code) {
      delete route.siteId;
      delete route.waterClass;
    }
    route.country = code;
    route.limit = 50;
    by('fish-country').value = code;
    localStorage.setItem('fish.country', code);
    window.dispatchEvent(new Event('journal-edited'));
    render();
  }
  let pending = 0;
  /** Retire the outstanding native country lookup before changing context. */
  function cancelLookup() {
    if (pending) window.Device.cancelLocation(pending);
    pending = 0;
  }
  by('fish-country').onchange = () => {
    cancelLookup();
    by('fish-gps').disabled = false;
    selectCountry(by('fish-country').value);
  };
  query.oninput = () => {
    route.query = query.value;
    route.limit = 50;
    render();
  };
  bind('more-fish', () => {
    route.limit = (route.limit || 50) + 50;
    render();
  });
  /** Ignore unrelated location replies when choosing the fish catalogue's country. */
  const receive = async ({ detail }) => {
    if (!pending || detail.id !== pending) return;
    try {
      const code = detail.fix && countryAt(await countryBorders('europe'), detail.fix);
      if (!view.active() || detail.id !== pending) return;
      if (code) selectCountry(code);
      else toast(t('fish_catalogue.country_unavailable_choose_it_from_the_list'));
    } catch {
      if (view.active() && detail.id === pending) toast(t('fish_catalogue.select_a_country_from_the_list'));
    } finally {
      if (view.active() && detail.id === pending) {
        pending = 0;
        by('fish-gps').disabled = false;
      }
    }
  };
  window.addEventListener('angler-position', receive);
  bind('fish-gps', () => {
    if (!window.Device?.location) return toast(t('common.gps_is_available_on_android'));
    by('fish-gps').disabled = true;
    pending = ++requestId;
    window.Device.location(pending);
  });
  view.dispose = () => {
    window.removeEventListener('angler-position', receive);
    cancelLookup();
  };
  render();
}

/** Format a month-day boundary independently of the device time zone. */
export function seasonalDay(day) {
  return new Intl.DateTimeFormat(languageTag, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date('2000-' + day + 'T12:00Z'),
  );
}

/** Keep each sourced restriction with its jurisdiction, water class and review deadline. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function fishDetail({ view, nav, waterDirectory }) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const { latin } = view.route,
    fish = data.names.get(latin);
  const fishingDay = validDay(view.route.day) ? view.route.day : '';
  const options = data.countries
    .map((c) => [c, countryName(c)])
    .sort((a, b) => a[1].localeCompare(b[1], languageTag));
  replaceMarkup(
    screen,
    back(catalogue()) +
      '<h1>' +
      esc(fish.label) +
      '</h1><p><i>' +
      esc(latin) +
      '</i> · ' +
      esc(fish.family || '') +
      '</p><h2>' +
      t('fish_catalogue.sizes_and_closed_seasons') +
      '</h2>' +
      selectField(
        'rule-country',
        t('fish_catalogue.fishing_country'),
        [['', t('fish_catalogue.choose_country')], ...options],
        view.route.country,
      ) +
      '<div id="water-class">' +
      selectField(
        'fish-water-class',
        t('fish_rules.water_class'),
        [
          ['nontrout', t('waters.non_trout_water')],
          ['cztrout', t('waters.trout_water')],
        ],
        view.route.waterClass || 'nontrout',
      ) +
      '</div>' +
      (fishingDay
        ? '<p>' + esc(t('seasons.fishing_date')) + ' · ' + esc(displayDay(fishingDay)) + '</p>'
        : '') +
      '<div id="fish-rules"></div>' +
      button('report-fish', t('fish_rules.report'), 'secondary') +
      '<p class="meta" id="report-address" hidden></p><details class="fold"><summary>' +
      t('fish_rules.species_sources') +
      '</summary><div class="fold-body"><p>' +
      [
        fish.river && t('fish_catalogue.freshwater_inventory'),
        fish.marine && t('fish_catalogue.marine_inventory'),
        fish.gbif?.length &&
          link('https://www.gbif.org/occurrence/search?scientific_name=' + encodeURIComponent(latin), 'GBIF'),

        fish.assessments &&
          link(
            'https://www.eea.europa.eu/en/datahub/datahubitem-view/202f3c2e-54a9-4ff4-a1da-ed7ca524f634',
            'EEA',
          ),
        fish.inat && link('https://www.inaturalist.org/taxa/' + fish.inat, 'iNaturalist'),
        ...Object.entries(data.checklists)
          .filter(([, c]) => c.species.includes(latin))
          .map(([code, c]) => link(c.source, countryName(code))),
      ]
        .filter(Boolean)
        .join(' · ') +
      '</p>' +
      '<p>' +
      t('fish_catalogue.documented_in') +
      ' · ' +
      esc(fish.countries.map(countryName).join(', ') || t('fish_catalogue.no_country_evidence')) +
      '</p></div></details>',
  );
  const assessment = Object.values(fish.assessments || {}).map((a) =>
    [a.europeanRegionalRedListCategory, a.extracted?.split('_')[0]].filter(Boolean).join(' · '),
  );
  if (assessment.length) {
    const line = document.createElement('p');
    line.textContent =
      t('fish_catalogue.historical_european_conservation_assessment_iucn_code_and') +
      ' · ' +
      [...new Set(assessment)].join(' / ');
    screen.querySelector('.fold-body').append(line);
  }
  bindBack(nav);
  bind('report-fish', () => {
    const code = by('rule-country').value;
    const body = [
      fish.label,
      latin,
      code && countryName(code),
      code === 'CZ' && by('fish-water-class').selectedOptions[0].textContent,
      fishingDay || undefined,
      waterDirectory.byId.get(view.route.siteId)?.name,
      window.Device?.versionLabel?.(),
      by('fish-size')?.innerText?.slice(0, 350),
      by('fish-size')?.querySelector('article a')?.getAttribute('href'),
      '',
      t('fish_rules.describe'),
    ]
      .filter((v) => typeof v === 'string')
      .join('\n');
    const address = by('report-address');
    address.textContent = t('fish_rules.contact') + ' · info@horistum.com';
    address.hidden = false;
    window.Device?.reportFish?.(t('fish_rules.report') + ' · ' + latin, body);
  });
  /** Display published conditions for the selected species and fishing jurisdiction. */
  function rules() {
    const code = by('rule-country').value,
      region = data.rules.countries[code];
    by('water-class').hidden = code !== 'CZ';
    if (!region) {
      by('fish-rules').textContent = t('fish_rules.choose_country');
      return;
    }
    const site = waterDirectory.byId.get(view.route.siteId);
    const { species: specific, water: waterRules } = scopedFishRules(
      data.rules,
      code,
      by('fish-water-class').value,
      latin,
      code === 'CZ' || fish.river || !fish.marine,
    );
    const today = fishingDay || new Date().toISOString().slice(0, 10);
    /** Render the scope and source alongside one fisheries rule. */
    function article(r, sizeOnly = false) {
      const source = data.rules.sources[r.source];
      const size = sizeTerms(r);
      const conditions = [
        r.daily != null && t('fish_catalogue.daily_limit') + ' · ' + r.daily,
        r.dailyKg != null && t('fish_catalogue.daily_limit') + ' · ' + r.dailyKg + ' kg',
        r.permitRequired && t('fish_catalogue.fishing_licence_required'),
        r.retentionClosed &&
          t('fish_catalogue.no_retention') + ' · ' + r.retentionClosed.map(seasonalDay).join(' – '),
        r.closed && t('fish-catalogue.closed.season') + ' · ' + r.closed.map(seasonalDay).join(' – '),
      ];
      const terms = (sizeOnly ? size : conditions).filter(Boolean);
      // A fixed-season regulation must never be presented as current in a later season.
      const inForce = (!r.validFrom || today >= r.validFrom) && (!r.validUntil || today <= r.validUntil);
      const dated = fishingDay && forFishingDate(r, source, fishingDay);
      const status =
        dated === 'unverified'
          ? t('dated_rules.unverified_date')
          : !inForce
            ? t('fish_catalogue.outside_the_period_of_validity_check_the')
            : today > source.reviewBy
              ? t('fish_catalogue.review_overdue_check_the_current_source')
              : terms.join(' · ');
      return (
        '<article class="surface"><strong>' +
        esc(words(data.rules.scopes[r.scope])) +
        '</strong><p>' +
        esc(status) +
        '</p>' +
        link(source.url, source.title) +
        ' · ' +
        t('fish_catalogue.source_checked') +
        ' ' +
        esc(source.checked) +
        '</article>'
      );
    }
    const sizes = specific.filter((r) => r.overCm != null || r.minCm != null || r.maxCm != null);
    const other = specific.filter(
      (r) => r.closed || r.retentionClosed || r.daily != null || r.dailyKg != null || r.permitRequired,
    );
    replaceMarkup(
      by('fish-rules'),
      '<section id="fish-size"><h3>' +
        t('fish_rules.size') +
        '</h3>' +
        (sizes.length
          ? sizes.map((r) => article(r, true)).join('')
          : '<p>' + t('fish_rules.size_unverified') + '</p>') +
        '</section><p>' +
        t('fish_catalogue.check_your_permit_local_rules_and_exceptions') +
        '</p>' +
        '<section id="species-restrictions"><h3>' +
        t('fish_rules.species_conditions') +
        '</h3>' +
        (other.length
          ? other.map((r) => article(r)).join('')
          : '<p>' + t('fish_rules.no_species_conditions') + '</p>') +
        '</section>' +
        (waterRules.length
          ? '<details id="water-wide-rules" class="fold"><summary>' +
            t('fish_rules.water_conditions') +
            '</summary><div class="fold-body">' +
            waterRules.map((r) => article(r)).join('') +
            '</div></details>'
          : '') +
        '<p>' +
        [
          site?.country === code && link(site.source, site.name),
          region.authority && link(region.authority, t('fish_catalogue.local_rules_and_permits')),
          link(region.url, 'FAOLEX'),
        ]
          .filter(Boolean)
          .join(' · ') +
        '</p>' +
        (waterDirectory.waters.some((water) => water.country === code)
          ? button('fish-local', t('fish_catalogue.rules_by_water'), 'secondary')
          : ''),
    );
    if (by('fish-local'))
      bind('fish-local', () =>
        nav.open('waterRules', {
          country: code,
          id: site?.country === code ? site.id : undefined,
          latin,
          day: view.route.day,
        }),
      );
  }
  by('fish-water-class').onchange = () => {
    view.route.waterClass = by('fish-water-class').value;
    rules();
  };
  by('rule-country').onchange = () => {
    delete view.route.siteId;
    view.route.country = by('rule-country').value;
    rules();
  };
  rules();
}
