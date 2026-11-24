import { language, languageTag } from './i18n.js';
import { by, screen, back, bindBack, bind, button, esc, field, selectField, t, link, toast } from './ui.js';
import { fold } from './domain.js';

let cache;
let requestId = 1000000;
const json = async name => {
  const response = await fetch(name + '.json');
  if (!response.ok) throw Error(name);
  return response.json();
};

/** Scientific names are the shared market keys. Translated labels are presentation only. */
export function fishDirectory() {
  if (!cache) cache = Promise.all([json('europe-fish'), json('fish-names-en'),
    language === 'en' ? {} : json('fish-names-' + (language === 'no' ? 'nb' : language)).catch(() => ({})), json('europe-rules'),json('europe-checklists')])
    .then(([data, english, local, rules, checklists]) => {
      const names = new Map();
      for (const fish of data.species) {
        fish.label = local[fish.latin] || english[fish.latin] || fish.latin;
        fish.search = fold([fish.latin,fish.label,english[fish.latin],...(fish.aliases || [])].filter(Boolean).join(' '));
        names.set(fish.latin, fish);
      }
      return { ...data, names, rules, checklists };
    }).catch(error => { cache = null; throw error; });
  return cache;
}

export function countryName(code) {
  try { return new Intl.DisplayNames([languageTag], { type: 'region' }).of(code); }
  catch { return code; }
}
export const fishOption = fish => fish.label === fish.latin ? fish.latin : fish.label + ' · ' + fish.latin;

/** Even/odd ray crossing; interior rings exclude enclaves and lakes in the source polygon. */
function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a,b] = ring[i], [c,d] = ring[j];
    if ((b > y) !== (d > y) && x < (c-a) * (y-b) / (d-b) + a) inside = !inside;
  }
  return inside;
}
export function countryAt(borders, { lon, lat }) {
  return Object.keys(borders).find(code => borders[code].some(([outer,...holes]) =>
    insideRing(lon,lat,outer) && !holes.some(hole => insideRing(lon,lat,hole)))) || '';
}

const words = entry => t(entry.message);
const fullList = () => t('fish_catalogue.all_of_europe');
const catalogue = () => t('fish_catalogue.title');

/** Both pickers use one persisted country and the same searchable species list. */
export function preferredCountry(data) {
  const code = localStorage.getItem('fish.country');
  return data.countries.includes(code) ? code : '';
}

export function countryOptions(data) {
  const countries = data.countries.map(code => [code, countryName(code)]);
  countries.sort((a, b) => a[1].localeCompare(b[1], languageTag));
  return [['', fullList()], ...countries];
}

export function matchingSpecies(data, country, query) {
  const term = fold(query.trim());
  return data.species.filter(fish =>
    (!country || fish.countries.includes(country)) && fish.search.includes(term))
    .sort((a, b) => a.label.localeCompare(b.label, languageTag));
}

/** GPS only suggests a country after a tap. No coordinates leave the phone or enter the catalogue. */
export async function fishCatalogue({view, nav}) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const route = view.route;
  route.country = preferredCountry(data);
  screen.innerHTML = back(t('common.back')) + '<h1>' + catalogue() + '</h1>' +
    selectField('fish-country',t('fish_catalogue.fishing_country'),countryOptions(data),route.country) +
    button('fish-gps',t('fish_catalogue.find_country_using_location'),'secondary') +
    field('fish-query',t('fish_catalogue.find_a_species'),'<input type="search" id="fish-query">') +
    '<p id="fish-count" role="status"></p><div class="water-list" id="fish-results"></div>' +
    button('more-fish',t('fish_catalogue.more_species'),'secondary');
  bindBack(nav);
  const query = by('fish-query');
  query.value = route.query || '';
  function render() {
    const matched = matchingSpecies(data, route.country, query.value);
    by('fish-count').textContent = t('fish_catalogue.species_count') + ' · ' + matched.length + (route.country ?
      ' · ' + t('fish_catalogue.documented_occurrences_choose_all_of_europe_for') : '');
    const shown = matched.slice(0,route.limit || 50);
    by('fish-results').replaceChildren(...shown.map(fish => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'secondary'; b.textContent = fishOption(fish);
      b.onclick = () => nav.open('fishDetail',{latin:fish.latin,country:route.country});
      return b;
    }));
    by('more-fish').hidden = shown.length >= matched.length;
  }
  function selectCountry(code) {
    route.country = code; route.limit = 50;
    by('fish-country').value = code;
    localStorage.setItem('fish.country',code);
    render();
  }
  let pending = 0;
  function cancelLookup() {
    if (pending) window.Device.cancelLocation(pending);
    pending = 0;
  }
  by('fish-country').onchange = e => {
    cancelLookup();
    by('fish-gps').disabled = false;
    selectCountry(e.target.value);
  };
  query.oninput = () => { route.query = query.value; route.limit = 50; render(); };
  bind('more-fish', () => { route.limit = (route.limit || 50) + 50; render(); });
  const receive = async ({detail}) => {
    if (!pending || detail.id !== pending) return;
    try {
      const code = detail.fix && countryAt(await json('europe-borders'), detail.fix);
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
  window.addEventListener('angler-position',receive);
  bind('fish-gps', () => {
    if (!window.Device?.location) return toast(t('common.gps_is_available_on_android'));
    by('fish-gps').disabled = true; pending = ++requestId; window.Device.location(pending);
  });
  view.dispose = () => {
    window.removeEventListener('angler-position',receive);
    cancelLookup();
  };
  render();
}

function seasonalDay(day) {
  return new Intl.DateTimeFormat(languageTag,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date('2000-' + day + 'T12:00Z'));
}

/** Keep each sourced restriction with its jurisdiction, water class and review deadline. */
export async function fishDetail({view, nav, waterDirectory}) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const {latin} = view.route, fish = data.names.get(latin);
  const options = data.countries.map(c => [c,countryName(c)]).sort((a,b) => a[1].localeCompare(b[1],languageTag));
  screen.innerHTML = back(catalogue()) + '<h1>' + esc(fish.label) + '</h1><p><i>' + esc(latin) + '</i> · ' + esc(fish.family || '') + '</p><p>' +
    [fish.river && t('fish_catalogue.freshwater_inventory'),fish.marine && t('fish_catalogue.marine_inventory'),
    fish.gbif?.length && link('https://www.gbif.org/occurrence/search?scientific_name='+encodeURIComponent(latin),'GBIF'),

    fish.assessments && link('https://www.eea.europa.eu/en/datahub/datahubitem-view/202f3c2e-54a9-4ff4-a1da-ed7ca524f634','EEA'),
    fish.inat && link('https://www.inaturalist.org/taxa/'+fish.inat,'iNaturalist'),
    ...Object.entries(data.checklists).filter(([,c]) => c.species.includes(latin)).map(([code,c]) => link(c.source,countryName(code)))].filter(Boolean).join(' · ') + '</p>' +
    '<p>' + t('fish_catalogue.documented_in') + ' · ' + esc(fish.countries.map(countryName).join(', ') || t('fish_catalogue.no_country_evidence')) + '</p><h2>' +
    t('fish_catalogue.sizes_and_closed_seasons') + '</h2>' +
    selectField('rule-country',t('fish_catalogue.fishing_country'),[['',t('fish_catalogue.choose_country')],...options],view.route.country) +
    '<div id="fish-rules"></div>';
  bindBack(nav);
  const assessment = Object.values(fish.assessments || {}).map(a =>
    [a.europeanRegionalRedListCategory, a.extracted?.split('_')[0]].filter(Boolean).join(' · '));
  if (assessment.length) {
    const line = document.createElement('p');
    line.textContent = t('fish_catalogue.historical_european_conservation_assessment_iucn_code_and') + ' · ' + [...new Set(assessment)].join(' / ');
    by('rule-country').closest('main')?.querySelector('h2')?.before(line);
  }
  function rules() {
    const code = by('rule-country').value, region = data.rules.countries[code];
    if (!region) { by('fish-rules').replaceChildren(); return; }
    const entries = data.rules.entries.filter(rule => rule.country === code);
    const specific = entries.filter(rule => rule.species.includes(latin));
    // Water-wide restrictions apply on the named waters regardless of the taxonomic inventory.
    const waterRules = entries.filter(rule => rule.allFreshwater);
    const today = new Date().toISOString().slice(0,10);
    function article(r) {
      const source = data.rules.sources[r.source];
      const terms = [
        r.overCm != null && t('fish_catalogue.length_must_exceed') + ' ' + r.overCm + ' cm',
        r.minCm != null && t('fish_catalogue.minimum_size') + ' · ' + r.minCm + ' cm',
        r.maxCm != null && t('fish_catalogue.maximum_retained_size') + ' · ' + r.maxCm + ' cm',
        r.daily != null && t('fish_catalogue.daily_limit') + ' · ' + r.daily,
        r.dailyKg != null && t('fish_catalogue.daily_limit') + ' · ' + r.dailyKg + ' kg',
        r.permitRequired && t('fish_catalogue.fishing_licence_required'),
        r.retentionClosed && t('fish_catalogue.no_retention') + ' · ' + r.retentionClosed.map(seasonalDay).join(' – '),
        r.closed && t('fish-catalogue.closed.season') + ' · ' + r.closed.map(seasonalDay).join(' – '),
      ].filter(Boolean);
      // A fixed-season regulation must never be presented as current in a later season.
      const inForce = (!r.validFrom || today >= r.validFrom) && (!r.validUntil || today <= r.validUntil);
      const status = !inForce ? t('fish_catalogue.outside_the_period_of_validity_check_the') :
        today > source.reviewBy ? t('fish_catalogue.review_overdue_check_the_current_source') : terms.join(' · ');
      return '<article class="surface"><strong>' + esc(words(data.rules.scopes[r.scope])) + '</strong><p>' +
        esc(status) +
        '</p>' + link(source.url,source.title) + ' · ' + t('fish_catalogue.source_checked') + ' ' + esc(source.checked) + '</article>';
    }
    by('fish-rules').innerHTML = '<p>' + t('fish_catalogue.check_your_permit_local_rules_and_exceptions') + '</p>' +
      (specific.length ? specific.map(article).join('') :
        '<p>' + t('fish_catalogue.no_reviewed_rule_for_this_species_and') + '</p>') +
      (waterRules.length ? '<section><h3>' + t('fish_catalogue.rules_for_all_species_on_the_listed') +
        '</h3>' + waterRules.map(article).join('') + '</section>' : '') +
      '<p>' + [region.authority && link(region.authority,t('fish_catalogue.local_rules_and_permits')),link(region.url,'FAOLEX')].filter(Boolean).join(' · ') + '</p>' +
      (waterDirectory.waters.some(water => water.country === code) ? button('fish-local',t('fish_catalogue.rules_by_water'),'secondary') : '');
    if (by('fish-local')) bind('fish-local',() => nav.open('waterRules', { country: code, latin }));
  }
  by('rule-country').onchange = () => { view.route.country = by('rule-country').value; rules(); };
  rules();
}
