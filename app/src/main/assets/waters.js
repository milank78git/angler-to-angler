import { parkingPoints, waterParking, waterRating } from './water-community.js';
import { atlasMap } from './world-map.js';
import { attachWaterPhoto } from './water-photo.js';
import { attachAtlasMap, waterFeature } from './atlas-map.js';
import { languageTag } from './i18n.js';
import { countryName } from './fish-catalogue.js';
import { atlasCountryAt, suggestedAtlasCountry } from './country-lookup.js';
import { localRuleWater, matchesWater, waterDistances } from './water-directory.js';
import { waterReports } from './water-reports.js';
import { rpc } from './profile-api.js';
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
  link,
  sectionTitle,
  selectField,
  emptyState,
  toast,
} from './ui.js';
/** Projects coordinates at local latitude using equal horizontal and vertical distance scales. */
export function waterMap(w, rivers, boundariesOnly = false, interactive = false) {
  const lines = rivers[w.id],
    pts = w.bounds.concat([w.danger], w.access ? [w.access.pt] : []);
  const cos = Math.cos((pts[0][1] * Math.PI) / 180);
  const xs = pts.map((p) => p[0] * cos),
    ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = Math.min(
    292 / (Math.max(...xs) - Math.min(...xs)),
    120 / (Math.max(...ys) - Math.min(...ys)),
  );
  const xy = (p) => [(170 + (p[0] * cos - cx) * scale).toFixed(1), (85 - (p[1] - cy) * scale).toFixed(1)];
  const paths = lines.map((line) => {
    const points = line.map((p) => xy(p).join(',')).join(' ');
    return `<polyline points="${points}" fill="none" stroke="#57978d" stroke-width="5" stroke-linejoin="round"/>`;
  });
  function marker(point, label, color) {
    const [x, y] = xy(point);
    return `<g transform="translate(${x} ${y})"><circle r="9" fill="${color}" stroke="white" stroke-width="1.7"/>
      <text y="3.8" text-anchor="middle" fill="white" font-size="11" font-weight="bold">${label}</text></g>`;
  }
  const open = interactive ? '<button type="button" id="pilot-map-open" class="map-open" aria-label="'+esc(t('atlas_map.open'))+'">' : '';
  return `<figure>${open}<svg aria-label="${t('waters.overview_of_river_and_boundary_points')}" role="img" viewBox="0 0 340 170">
    <defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#cbd8cd" stroke-width=".8"/></pattern></defs>
    <rect width="340" height="170" fill="url(#grid)"/>${paths.join('')}
    ${marker(w.bounds[0], '1', '#294f43')}${marker(w.bounds[1], '2', '#294f43')}${boundariesOnly ? '' : marker(w.danger, '!', '#9c4736')}
    ${w.access && !boundariesOnly ? marker(w.access.pt, 'A', '#33668c') : ''}<text x="315" y="21" font-size="12" fill="#476554">↑ N</text>
    </svg>${interactive ? `<span>${t('atlas_map.open')}</span></button>` : ''}<figcaption>${link('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors · ODbL')}</figcaption></figure>`;
}
function isFavorite(pack, w) {
  return localStorage.getItem(`water.${window.Device.subjectId()}.${pack.id}.${w.id}`) === '1';
}
function favoriteButton(pack, w) {
  const saved = isFavorite(pack, w);
  const label = saved
    ? t('waters.remove_from_favorites')
    : t('waters.save_to_favorites');
  return `<button class="icon-btn favorite" type="button" data-favorite="${esc(w.id)}" aria-label="${esc(label + ' · ' + w.name)}" aria-pressed="${saved}">${icon('bookmark')}</button>`;
}
function toggleFavorite(pack, id) {
  const w = pack.waters.find((x) => x.id === id);
  const key = `water.${window.Device.subjectId()}.${pack.id}.${id}`;
  if (isFavorite(pack, w)) localStorage.removeItem(key);
  else localStorage.setItem(key, '1');
}
let locationRequest = 2000000;

/** Describe the published geographic scope even for countries without an offline edition. */
function coverage(directory, country) {
  if (!country) return '';
  const links = [];
  if (country === 'CZ') links.push(link('https://ris.rybsvaz.cz/soupisy',t('sources.crs.short')),link('https://mrsbrno.cz/reviry','MRS'));
  if (country === 'US') links.push(link('https://fwp.mt.gov/fish/fishing-access','Montana FWP'));
  const providers = Object.values(directory.sources.providers).filter(p => p.country === country);
  links.push(...providers.map(p => link(p.url, p.label + ' · ' + p.scope)));
  const local = directory.sources.directories[country];
  if (local) links.push(link(local[1], local[0]));
  const rules = directory.countries[country];
  if (rules) links.push(link(rules.authority || rules.url, t('waters.national_fishing_information')));
  const missing = !providers.length && !['CZ','US'].includes(country);
  return (missing ? '<p>' + t('waters.an_offline_directory_is_not_yet_available') + '</p>' : '')
    + links.map(l => '<p>' + l + '</p>').join('');
}

export async function listWaters({ view, pack, nav, waterDirectory }) {
  const parking = await parkingPoints().catch(() => null);
  if (!view.active()) return;
  const collator = new Intl.Collator(languageTag, { numeric: true, sensitivity: 'base', ignorePunctuation: true });
  const ordered = [...waterDirectory.waters].sort((a, b) => collator.compare(a.name, b.name) ||
    collator.compare(a.number || '', b.number || '') || collator.compare(a.key, b.key));
  const atlas = { ...pack, waters: ordered };
  const { route } = view;
  if (!parking && route.parkingOnly) {
    route.parkingOnly = false;
    route.filtersOpen = true;
  }
  if (route.geography !== waterDirectory.geography) {
    delete route.distances;
    route.geography = waterDirectory.geography;
  }
  const countries = [...new Set([...Object.keys(waterDirectory.countries),'CZ','US'])]
    .map(code => [code, countryName(code)]).sort((a,b) => a[1].localeCompare(b[1]));
  const subject = window.Device.subjectId();
  const countryPreference = 'atlas.country.' + subject;
  const locationChoice = 'atlas.location-choice.' + subject;
  const previous = localStorage.getItem(countryPreference);
  const savedCountry = previous === '' || countries.some(([code]) => code === previous);
  if (route.country === undefined && !route.additions) {
    route.country = savedCountry ? previous : suggestedAtlasCountry(ordered, window.Device.networkCountry?.(),
      Intl.DateTimeFormat().resolvedOptions().timeZone, languageTag);
  }
  const offerLocation = !route.additions && !savedCountry && !localStorage.getItem(locationChoice);
  screen.innerHTML = `<div class="page-intro"><div class="title-mark">${icon('map')}</div><h1>${t('atlas.title')}</h1></div>
    ${offerLocation ? `<aside id="atlas-location-offer" class="surface" aria-labelledby="atlas-location-title">
      <h2 id="atlas-location-title">${t('atlas.location_title')}</h2><p>${t('atlas.location_explanation')}</p>
      <div class="quick-actions">${button('atlas-location-use',t('atlas.location_use'),'primary','navigation')}${button('atlas-location-skip',t('atlas.location_skip'),'secondary')}</div></aside>` : ''}
    <p id="nearby-status" role="status"></p>
    <div class="quick-actions home-features">${button('home-market', t('market.title'), 'primary')}${button('home-fish', t('fish_catalogue.title'), 'secondary', 'fish-symbol')}</div>
    <div class="catalog-tools"><div class="search-box">${icon('search')}<label class="sr" for="search">${t('waters.name_water_number_or_town')}</label><input type="search" id="search" value="${esc(route.query || '')}" placeholder="${t('waters.search_waters_numbers_or_towns')}"></div>
    <div class="atlas-actions">${button('atlas-filter-toggle',t('settings.filters'),'secondary','sliders-horizontal')}${button('atlas-settings',t('settings.title'),'secondary')}${button('map-toggle',t('atlas.map'),'secondary','map')}</div>
    <div id="atlas-filters">
    ${button('atlas-locate-country',t('atlas.location_use'),'secondary','navigation')}
    ${button('nearby',t('waters.sort_by_location'),'secondary','navigation')}
    ${selectField('water-country', t('waters.fishery_country'), [
      ['', t('waters.all_countries')], ...countries
    ], route.country || '')}
    <label class="card-option"><input id="water-parking" type="checkbox"${route.parkingOnly ? ' checked' : ''}${parking ? '' : ' disabled'}>${esc(t('parking.filter'))}</label>
    <div id="parking-index-error" hidden><span role="status">${esc(t('parking.filter_offline'))}</span> ${button('retry-parking-index',t('common.retry'),'secondary')}</div>
    ${parking ? '' : '<p role="status">' + esc(t('parking.unavailable')) + '</p>' + button('retry-parking',t('common.retry'),'secondary')}
    <details id="atlas-sources"><summary>${t('seasons.coverage_and_sources')}</summary><div id="water-coverage"></div></details></div>
    <div class="filter-row"><div class="segments">${button('all', t('common.all'))}${button('saved', t('waters.favorites'), '', 'bookmark')}</div><span class="count" id="found" role="status"></span></div></div>
    ${route.additions ? '<p class="meta">'+t('alerts.waters')+' · '+button('clear-additions',t('common.all'),'secondary')+'</p>' : ''}<section id="atlas-world" class="surface" hidden></section><div id="waters" class="water-list"></div>${button('more-waters', t('waters.show_more_waters'), 'secondary')}`;
  if (route.additions) bind('clear-additions', () => { delete route.additions; nav.show(); });
  const filters=by('atlas-filters'), toggle=by('atlas-filter-toggle');
  function syncFilters() {
    filters.hidden = !(route.filtersOpen ?? matchMedia('(min-width: 600px)').matches);
    toggle.setAttribute('aria-expanded',String(!filters.hidden));
    toggle.querySelector('span').textContent = [
      t('settings.filters'), route.country && countryName(route.country), route.parkingOnly && t('parking.filter')
    ].filter(Boolean).join(' · ');
  }
  toggle.setAttribute('aria-controls',filters.id);
  toggle.onclick=() => { route.filtersOpen=filters.hidden; syncFilters(); };
  syncFilters();
  if (!parking) bind('retry-parking', () => nav.show());
  let sharedParking = new Set(), parkingRequest = 0;
  const indexError=by('parking-index-error');
  async function loadSharedParking() {
    const request=++parkingRequest;
    indexError.hidden=true;
    try {
      const data = await rpc('parking_waters');
      if (!view.active() || request!==parkingRequest) return;
      if (!Array.isArray(data?.waters)) throw Error('Invalid parking index');
      sharedParking = new Set(data.waters);
      if (route.parkingOnly) results();
    } catch {
      if (view.active() && request===parkingRequest) indexError.hidden=!route.parkingOnly;
    }
  }
  bind('retry-parking-index',loadSharedParking);
  by('water-parking').onchange = event => {
    indexError.hidden=true;
    route.parkingOnly = event.target.checked;
    if (route.parkingOnly) loadSharedParking();
    route.limit = pageSize;
    syncFilters();
    results();
  };
  bind('atlas-settings', () => window.Device?.openWaterSettings?.());
  bind('home-market', () => nav.open('marketShelf'));
  bind('home-fish', () => nav.open('fishCatalogue'));
  const pageSize = 40;
  let pending = 0, locatingCountry = false;
  const distanceNote = t('waters.approximate_distance_to_the_mapped_water_section');
  const status = by('nearby-status');
  if (route.distances) status.textContent = distanceNote;

  function dismissOffer() {
    const offer = by('atlas-location-offer');
    if (offer) {
      offer.hidden = true;
      localStorage.setItem(locationChoice, '1');
    }
  }
  function setCountry(code) {
    route.country = code;
    localStorage.setItem(countryPreference, code);
    by('water-country').value = code;
    by('atlas-sources').hidden = !code;
    by('water-coverage').innerHTML = coverage(waterDirectory, code);
    syncFilters();
  }
  function setLocationBusy(busy) {
    by('nearby').disabled = busy;
    by('atlas-locate-country').disabled = busy;
  }
  function cancelLocation() {
    if (pending) window.Device.cancelLocation(pending);
    pending = 0;
  }
  function requestLocation(findCountry) {
    if (pending) return;
    if (!window.Device?.atlasLocation) return toast(t('waters.location_unavailable'));
    dismissOffer();
    locatingCountry = findCountry;
    pending = ++locationRequest;
    setLocationBusy(true);
    status.textContent = t('atlas.locating');
    window.Device.atlasLocation(pending);
  }
  const receive = async ({ detail }) => {
    if (!pending || detail.id !== pending) return;
    try {
      if (!Number.isFinite(detail.fix?.lat) || !Number.isFinite(detail.fix?.lon)) {
        status.textContent = t('atlas.location_failed');
        return;
      }
      if (locatingCountry) {
        const code = await atlasCountryAt(detail.fix);
        if (!view.active() || detail.id !== pending) return;
        if (!code) {
          status.textContent = t('fish_catalogue.country_unavailable_choose_it_from_the_list');
          route.filtersOpen = true;
          syncFilters();
          return;
        }
        setCountry(code);
        route.limit = pageSize;
        results();
      }
      const shapes = await waterDirectory.geography();
      if (!view.active() || detail.id !== pending) return;
      route.distances = waterDistances(atlas.waters, shapes, detail.fix);
      route.limit = pageSize;
      status.textContent = distanceNote;
      results();
    } catch {
      if (view.active() && detail.id === pending) status.textContent = t('atlas.location_failed');
    } finally {
      if (view.active() && detail.id === pending) {
        pending = 0;
        setLocationBusy(false);
      }
    }
  };
  window.addEventListener('angler-position',receive);
  if (offerLocation) {
    bind('atlas-location-use', () => requestLocation(true));
    bind('atlas-location-skip', dismissOffer);
  }
  bind('atlas-locate-country', () => requestLocation(true));
  bind('nearby', () => requestLocation(false));
  view.dispose = () => {
    window.removeEventListener('angler-position',receive);
    cancelLocation();
    map?.dispose();
  };
  let map, shapes, mapGeneration=0;
  const mapHost=by('atlas-world');
  bind('map-toggle',()=>{route.mapOpen=!route.mapOpen;results();});
  function results() {
    const q = Domain.fold(route.query || '');
    const { distances, limit = pageSize } = route;
    const matches = atlas.waters.filter(
      (w) =>
        (!route.additions || route.additions.has(w.code ? w.provider + ':' + w.code : w.key)) &&
        (!route.country || route.country === w.country) && (!route.favorites || isFavorite(pack, w)) &&
        (!route.parkingOnly || (parking[w.key]?.length > 0 || sharedParking.has(w.key))) && matchesWater(w, q),
    );
    if (distances) matches.sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity));
    const shown = matches.slice(0, limit);
    const generation=++mapGeneration;
    mapHost.hidden=!route.mapOpen;
    by('waters').hidden=!!route.mapOpen;
    by('map-toggle').setAttribute('aria-pressed',String(!!route.mapOpen));
    by('map-toggle').querySelector('span').textContent=t(route.mapOpen?'atlas.list':'atlas.map');
    if (!route.mapOpen) map?.pause();
    if(route.mapOpen){
      map ||= atlasMap(mapHost,route,id=>nav.open('water',{id}));
      shapes ||= waterDirectory.geography().catch(()=>{shapes=null;return {};});
      shapes.then(geometry=>{
        if(view.active() && generation===mapGeneration)
          map.update(matches,geometry,JSON.stringify([q,route.country,route.favorites,!!route.parkingOnly]));
      });
    }
    by('more-waters').hidden = !!route.mapOpen || matches.length <= limit;
    by('all').setAttribute('aria-pressed', String(!route.favorites));
    by('saved').setAttribute('aria-pressed', String(!!route.favorites));
    by('found').textContent = t('waters.waters') + ' · ' + matches.length;
    by('waters').innerHTML =
      shown.map(w => `<article class="water-card"><button type="button" class="water-open" data-water="${esc(w.id)}">
      <span class="water-copy"><span class="number">${esc([w.number || w.code, w.country].filter(Boolean).join(' · '))}</span><strong>${esc(w.name)}</strong><span class="sub">${esc(w.area)}${distances?.has(w.id) ? ' · ' + distances.get(w.id).toFixed(1) + ' km' : ''}</span></span></button>${favoriteButton(pack, w)}</article>`).join('') ||
      emptyState(
        route.favorites ? 'bookmark' : 'search',
        route.favorites && !q && !route.parkingOnly
          ? t('waters.no_favorites_yet')
          : t('waters.no_matching_water'),
        route.parkingOnly ? t('parking.filter_empty') :
          route.favorites && !q ? t('waters.use_the_bookmark_beside_a_water_to') : t('waters.try_another_number_name_or_town'),
      );
    by('waters')
      .querySelectorAll('[data-water]')
      .forEach((b) => (b.onclick = () => nav.open('water', { id: b.dataset.water })));
    by('waters')
      .querySelectorAll('[data-favorite]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            toggleFavorite(atlas, b.dataset.favorite);
            results();
            const target = Array.from(by('waters').querySelectorAll('[data-favorite]')).find(
              (el) => el.dataset.favorite === b.dataset.favorite,
            );
            (target || by('saved')).focus({ preventScroll: true });
          }),
      );
  }
  bind('more-waters', () => {
    const previous = route.limit || pageSize;
    route.limit = previous + pageSize;
    results();
    by('waters').querySelectorAll('[data-water]')[previous]?.focus();
  });
  by('water-country').onchange = event => {
    cancelLocation();
    setLocationBusy(false);
    dismissOffer();
    status.textContent = route.distances ? distanceNote : '';
    setCountry(event.target.value);
    route.limit = pageSize;
    results();
  };
  bind('all', () => {
    route.favorites = false;
    route.limit = pageSize;
    results();
  });
  bind('saved', () => {
    route.favorites = true;
    route.limit = pageSize;
    results();
  });
  by('search').oninput = () => {
    route.query = by('search').value;
    route.limit = pageSize;
    results();
  };
  by('atlas-sources').hidden = !route.country;
  by('water-coverage').innerHTML = coverage(waterDirectory, route.country);
  results();
  if (route.parkingOnly) loadSharedParking();
}
function waterActions() {
  return '<div class="quick-actions">' +
    button('new-trip', t('waters.log_a_trip'), 'primary', 'plus') +
    button('open-rules', t('common.seasons_sizes'), 'secondary', 'calendar-days') +
    button('open-activity', t('common.water_activity'), 'secondary') +
    button('open-discussion', t('common.observations_and_questions'), 'secondary') +
    button('water-market', t('waters.offers_on_this_water'), 'secondary') + '</div><section class="surface" id="parking"></section><section class="surface" id="water-rating"></section>';
}

function bindWaterActions(nav, water) {
  waterParking(by('parking'),water,nav);
  waterRating(by('water-rating'),water);
  bind('new-trip', () => nav.open('newTrip', { water: water.id }));
  bind('open-rules', () => nav.open('waterRules', { id: water.id }));
  bind('open-activity', () => nav.open('waterActivity', { id: water.id }));
  bind('open-discussion', () => nav.open('waterDiscussion', { id: water.id }));
  bind('water-market', () => nav.open('marketShelf', { water: water.key }));
}

export function waterScreen({ view, pack, rivers, nav, waterDirectory }) {
  const { route } = view;
  const site = waterDirectory.byId.get(route.id);
  if (!site) return nav.back();
  const w = localRuleWater(pack, site);
  const bundled = site.photo || pack.waterPhotos?.[site.key];
  const feature = !w || !bundled ? waterFeature(site, waterDirectory) : null;
  const heading = '<header class="water-heading"><h1>' + esc(site.name) + '</h1>' +
    (w ? favoriteButton(pack, w) : '') + '</header><section id="water-photo"></section>';
  if (!w) {
    const us = site.provider === 'FWP';
    const publisher = site.publisher || { CRS: t('sources.crs.name'), MRS: t('sources.mrs.name'), FWP: 'Montana Fish, Wildlife & Parks' }[site.provider];
    const types = { section:t('waters.fishing_section'), management:t('waters.fishery_management_area_reference_point'), access:t('waters.fishing_access_site'), fishery: t('waters.fishery'), pond: t('waters.pond'), water: t('waters.water_body') };
    const facts = us ? [t('waters.fishing_access_site'), site.area, site.access.pt.slice().reverse().join(', ')]
      : [site.number, types[site.kind], typeof site.trout === 'boolean' && (site.trout ? t('waters.trout_water') : t('waters.non_trout_water')),
        site.scope, site.status, site.area !== site.scope && site.publisher && site.area, site.licence,
        site.region, site.manager && t('waters.organisation') + ' · ' + site.manager,
        site.acreage && site.acreage + ' ha', site.length && site.length + ' km'];
    screen.innerHTML = back(t('atlas.title')) + heading + '<section class="surface" id="atlas-map"></section><section class="surface">' +
      sectionTitle('map', t('waters.official_details')) +
      facts.filter(Boolean).map(value => '<p>' + esc(value) + '</p>').join('') + link(site.source, publisher) +
      (us ? '' : '<p class="meta">' + t('waters.imported_on') + ' · ' + esc(site.asOf || waterDirectory.asOf) + '</p>' +
        (site.mapped ? '<p>' + t('waters.nearby_sorting_uses_the_published_water_outline') + '</p>' :
          site.lines ? '<p>' + t('waters.nearby_sorting_uses_the_published_course_of') + '</p>' :
          site.points ? '<details><summary>' + t('waters.published_coordinates') + ' (' + site.points.length + ')</summary>' +
            site.points.map(([lon, lat]) => '<p>' + esc(lat) + ', ' + esc(lon) + '</p>').join('') + '</details>' :
            '<p>' + t('waters.this_water_has_no_location_in_the') + '</p>')) +
      '</section>' + waterActions() +
      '<section class="surface"><h2>' + t('waters.water_reports') + '</h2><div id="water-reports"></div></section>';
    bindBack(nav);
    bindWaterActions(nav, site);
    attachWaterPhoto(by('water-photo'), site, bundled, feature, view);
    attachAtlasMap(by('atlas-map'), site, waterDirectory, view, feature);
    waterReports(by('water-reports'), site.key, view);
    return;
  }
  const landmark = (mark, text) =>
    `<li><span class="point p${mark === '!' ? 'danger' : mark}">${mark}</span>${esc(text)}</li>`;
  screen.innerHTML =
    back(t('atlas.title')) +
    heading + `<p class="area-line">${icon('map-pin')}${esc(w.number)} · ${esc(loc(pack.label))} · ${esc(w.area)}</p>
    ${waterActions()}
    <div class="columns"><section class="surface">${sectionTitle('map', t('waters.water_map'))}${waterMap(w, rivers, false, true)}<ul class="legend">${landmark('1', loc(w.ends[0]))}${landmark('2', loc(w.ends[1]))}${landmark('!', loc(w.restriction))}${w.access ? landmark('A', loc(w.access)) : ''}</ul></section>
    <section class="surface">${sectionTitle('navigation', t('waters.getting_to_the_water'))}${w.access ? `<p>${esc(loc(w.access))}</p><div class="actions">${button('navigate', t('waters.open_directions'), 'secondary', 'navigation')}</div><div class="rulesrc">${link(w.access.source, t('waters.access_point_source'))}</div>` : `<p class="muted">${t('waters.this_pack_has_no_verified_access_point')}</p>`}</section></div>`;
  bindBack(nav);
  bindWaterActions(nav, site);
  attachWaterPhoto(by('water-photo'), site, bundled, feature, view);
  const waterKey = site.key;
  screen.insertAdjacentHTML('beforeend','<section class="surface"><h2>'+t('waters.water_reports')+'</h2><div id="water-reports"></div></section>');
  waterReports(by('water-reports'),waterKey,view);
  by('water-reports').parentElement.insertAdjacentHTML('beforebegin',link(w.source,t('waters.official_fishery_record')));
  const marketButton = by('water-market');
  // Availability is online. The atlas and the link remain usable while counts load or fail.
  rpc('market_discover', { water_key: waterKey, before_position: null }).then(result => {
    if (view.active()) marketButton.querySelector('span').textContent += ' (' + result.stats.offers + ')';
  }).catch(() => {
    if (view.active()) marketButton.querySelector('span').textContent += ' · ' + t('waters.count_unavailable');
  });
  const fav = screen.querySelector('[data-favorite]');
  fav.onclick = () => {
    toggleFavorite(pack, w.id);
    fav.setAttribute('aria-pressed', String(isFavorite(pack, w)));
    fav.setAttribute(
      'aria-label',
      (isFavorite(pack, w)
        ? t('waters.remove_from_favorites')
        : t('waters.save_to_favorites')) +
        ' · ' +
        w.name,
    );
  };
  const destination = w.access?.pt || w.bounds[0];
  bind('pilot-map-open', () => window.Device ? Device.navigate(destination[1], destination[0])
    : toast(t('waters.directions_are_available_on_android')));
  if (w.access)
    bind('navigate', () =>
      window.Device
        ? Device.navigate(w.access.pt[1], w.access.pt[0])
        : toast(t('waters.directions_are_available_on_android')),
    );
}
