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
        fish.label = fish[language] || local[fish.latin] || (language === 'cs' && fish.name) || fish.en || english[fish.latin] || fish.latin;
        fish.search = fold([fish.latin,fish.label,fish.en,english[fish.latin],...(fish.aliases || [])].filter(Boolean).join(' '));
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

const words = pair => t(pair.cs,pair.en);
const fullList = () => t('Celá Evropa', 'All of Europe');
const catalogue = () => t('Katalog ryb', 'Fish catalogue');

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
  screen.innerHTML = back(t('Zpět','Back')) + '<h1>' + catalogue() + '</h1>' +
    selectField('fish-country',t('Země lovu','Fishing country'),countryOptions(data),route.country) +
    button('fish-gps',t('Najít zemi podle polohy','Find country using location'),'secondary') +
    field('fish-query',t('Hledat druh','Find a species'),'<input type="search" id="fish-query">') +
    '<p id="fish-count" role="status"></p><div class="water-list" id="fish-results"></div>' +
    button('more-fish',t('Další druhy','More species'),'secondary');
  bindBack(nav);
  const query = by('fish-query');
  query.value = route.query || '';
  function render() {
    const matched = matchingSpecies(data, route.country, query.value);
    by('fish-count').textContent = t('Počet druhů', 'Species count') + ' · ' + matched.length + (route.country ?
      ' · ' + t('Doložený výskyt. Celý seznam zobrazíš volbou Celá Evropa.', 'Documented occurrences. Choose All of Europe for the full list.') : '');
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
      else toast(t('Zemi se nepodařilo určit. Vyber ji ze seznamu.', 'Country unavailable. Choose it from the list.'));
    } catch {
      if (view.active() && detail.id === pending) toast(t('Vyber zemi ze seznamu.', 'Select a country from the list.'));
    } finally {
      if (view.active() && detail.id === pending) {
        pending = 0;
        by('fish-gps').disabled = false;
      }
    }
  };
  window.addEventListener('angler-position',receive);
  bind('fish-gps', () => {
    if (!window.Device?.location) return toast(t('GPS je dostupná na Androidu.','GPS is available on Android.'));
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
export async function fishDetail({view, nav, pack}) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const {latin} = view.route, fish = data.names.get(latin);
  const options = data.countries.map(c => [c,countryName(c)]).sort((a,b) => a[1].localeCompare(b[1],languageTag));
  screen.innerHTML = back(catalogue()) + '<h1>' + esc(fish.label) + '</h1><p><i>' + esc(latin) + '</i> · ' + esc(fish.family || '') + '</p><p>' +
    [fish.river && t('Sladkovodní soupis','Freshwater inventory'),fish.marine && t('Mořský soupis','Marine inventory'),
    fish.gbif?.length && link('https://www.gbif.org/occurrence/search?scientific_name='+encodeURIComponent(latin),'GBIF'),

    fish.assessments && link('https://www.eea.europa.eu/en/datahub/datahubitem-view/202f3c2e-54a9-4ff4-a1da-ed7ca524f634','EEA'),
    fish.inat && link('https://www.inaturalist.org/taxa/'+fish.inat,'iNaturalist'),
    ...Object.entries(data.checklists).filter(([,c]) => c.species.includes(latin)).map(([code,c]) => link(c.source,countryName(code)))].filter(Boolean).join(' · ') + '</p>' +
    '<p>' + t('Doložený výskyt v zemích', 'Documented in') + ' · ' + esc(fish.countries.map(countryName).join(', ') || t('Chybí údaj o zemi','No country evidence')) + '</p><h2>' +
    t('Míry a hájení', 'Sizes and closed seasons') + '</h2>' +
    selectField('rule-country',t('Země lovu','Fishing country'),[['',t('Vyber zemi','Choose country')],...options],view.route.country) +
    '<div id="fish-rules"></div>';
  bindBack(nav);
  const assessment = Object.values(fish.assessments || {}).map(a =>
    [a.europeanRegionalRedListCategory, a.extracted?.split('_')[0]].filter(Boolean).join(' · '));
  if (assessment.length) {
    const line = document.createElement('p');
    line.textContent = t('Historické evropské hodnocení ohrožení (kód IUCN a rok podkladu)','Historical European conservation assessment (IUCN code and source year)') + ' · ' + [...new Set(assessment)].join(' / ');
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
        r.overCm != null && t('Délka musí být větší než','Length must exceed') + ' ' + r.overCm + ' cm',
        r.minCm != null && t('Nejmenší míra','Minimum size') + ' · ' + r.minCm + ' cm',
        r.maxCm != null && t('Největší ponechaná ryba','Maximum retained size') + ' · ' + r.maxCm + ' cm',
        r.daily != null && t('Denní limit','Daily limit') + ' · ' + r.daily,
        r.dailyKg != null && t('Denní limit','Daily limit') + ' · ' + r.dailyKg + ' kg',
        r.permitRequired && t('Vyžaduje se rybářská licence','Fishing licence required'),
        r.retentionClosed && t('Zákaz ponechání úlovku','No retention') + ' · ' + r.retentionClosed.map(seasonalDay).join(' – '),
        r.closed && t('Doba hájení','Closed season') + ' · ' + r.closed.map(seasonalDay).join(' – '),
      ].filter(Boolean);
      // A fixed-season regulation must never be presented as current in a later season.
      const inForce = (!r.validFrom || today >= r.validFrom) && (!r.validUntil || today <= r.validUntil);
      const status = !inForce ? t('Mimo období platnosti. Ověř aktuální předpis.', 'Outside the period of validity. Check the current regulation.') :
        today > source.reviewBy ? t('Uplynul termín kontroly. Ověř aktuální znění přímo u zdroje.', 'Review overdue. Check the current source.') : terms.join(' · ');
      return '<article class="surface"><strong>' + esc(words(data.rules.scopes[r.scope])) + '</strong><p>' +
        esc(status) +
        '</p>' + link(source.url,source.title) + ' · ' + t('Kontrola zdroje','Source checked') + ' ' + esc(source.checked) + '</article>';
    }
    by('fish-rules').innerHTML = '<p>' + t('Před lovem ověř povolenku a místní podmínky včetně výjimek.', 'Check your permit, local rules and exceptions before fishing.') + '</p>' +
      (specific.length ? specific.map(article).join('') :
        '<p>' + t('Pro tento druh a stát zatím chybí ověřené pravidlo.', 'No reviewed rule for this species and country yet.') + '</p>') +
      (waterRules.length ? '<section><h3>' + t('Společná pravidla pro uvedené vody', 'Rules for all species on the listed waters') +
        '</h3>' + waterRules.map(article).join('') + '</section>' : '') +
      '<p>' + [region.authority && link(region.authority,t('Místní zdroj pravidel','Local rules and permits')),link(region.url,'FAOLEX')].filter(Boolean).join(' · ') + '</p>' +
      (code === pack.country.toUpperCase() ? button('fish-local',t('Pravidla konkrétních revírů','Rules by water'),'secondary') : '');
    if (by('fish-local')) bind('fish-local',() => nav.open('rules'));
  }
  by('rule-country').onchange = () => { view.route.country = by('rule-country').value; rules(); };
  rules();
}
