import { attachAtlasMap } from './atlas-map.js';
import { countryName } from './fish-catalogue.js';
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
function photo(w, cls = '') {
  return w?.photo ? `<img class="${cls}" src="${esc(w.photo.asset)}" alt="">` : '';
}
function credits(...waters) {
  const photos = waters.filter((w) => w?.photo);
  if (!photos.length) return '';
  const rows = photos.map((w) => {
    const p = w.photo;
    return `<p>${esc(w.name)} · ${link(p.source, p.author)} · ${link(p.licenseUrl, p.license)}</p>`;
  });
  return `<details class="credits"><summary>${icon('image')}${t('waters.photo_credits')}</summary>${rows.join('')}<p>${t('waters.resized_and_cropped')}</p></details>`;
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

export function listWaters({ view, pack, nav, waterDirectory }) {
  const atlas = { ...pack, waters: waterDirectory.waters };
  const { route } = view;
  if (route.geography !== waterDirectory.geography) {
    delete route.distances;
    route.geography = waterDirectory.geography;
  }
  const countries = [...new Set([...Object.keys(waterDirectory.countries),'CZ','US'])]
    .map(code => [code, countryName(code)]).sort((a,b) => a[1].localeCompare(b[1]));
  const cover = pack.waters.find((w) => w.id === pack.coverWater) || pack.waters[0];
  screen.innerHTML = `<section class="hero atlas-hero">${photo(cover, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${t('waters.czechia_and_abroad')}</div><h1>${t('atlas.title')}</h1></div>
    <span class="photo-place">${esc(cover?.name || '')}</span></section>
    <div class="quick-actions home-features">${button('home-market', t('market.title'), 'primary')}${button('home-fish', t('fish_catalogue.title'), 'secondary', 'fish-symbol')}</div>
    <div class="catalog-tools"><div class="search-box">${icon('search')}<label class="sr" for="search">${t('waters.name_water_number_or_town')}</label><input type="search" id="search" value="${esc(route.query || '')}" placeholder="${t('waters.search_waters_numbers_or_towns')}"></div>
    <div class="atlas-actions">${button('atlas-filter-toggle',t('settings.filters'),'secondary','sliders-horizontal')}${button('atlas-settings',t('settings.title'),'secondary')}</div>
    <div id="atlas-filters">
    ${button('nearby',t('waters.sort_by_location'),'secondary','navigation')}<p id="nearby-status" role="status"></p>
    ${selectField('water-country', t('waters.fishery_country'), [
      ['', t('waters.all_countries')], ...countries
    ], route.country || '')}<details id="atlas-sources"><summary>${t('seasons.coverage_and_sources')}</summary><div id="water-coverage"></div></details></div>
    <div class="filter-row"><div class="segments">${button('all', t('common.all'))}${button('saved', t('waters.favorites'), '', 'bookmark')}</div><span class="count" id="found" role="status"></span></div></div>
    ${route.additions ? '<p class="meta">'+t('alerts.waters')+' · '+button('clear-additions',t('common.all'),'secondary')+'</p>' : ''}<div id="waters" class="water-list"></div>${button('more-waters', t('waters.show_more_waters'), 'secondary')}${credits(...pack.waters)}`;
  if (route.additions) bind('clear-additions', () => { delete route.additions; nav.show(); });
  const filters=by('atlas-filters'), toggle=by('atlas-filter-toggle');
  function syncFilters() {
    filters.hidden = !(route.filtersOpen ?? matchMedia('(min-width: 600px)').matches);
    toggle.setAttribute('aria-expanded',String(!filters.hidden));
    toggle.querySelector('span').textContent=t('settings.filters')+(route.country ? ' · '+countryName(route.country) : '');
  }
  toggle.setAttribute('aria-controls',filters.id);
  toggle.onclick=() => { route.filtersOpen=filters.hidden; syncFilters(); };
  syncFilters();
  bind('atlas-settings', () => window.Device?.openWaterSettings?.());
  bind('home-market', () => nav.open('marketShelf'));
  bind('home-fish', () => nav.open('fishCatalogue'));
  const pageSize = 40;
  let pending;
  const distanceNote = t('waters.approximate_distance_to_the_mapped_water_section');
  if (route.distances) by('nearby-status').textContent = distanceNote;
  const receive = async ({ detail }) => {
    if (!pending || detail.id !== pending) return;
    pending = null;
    try {
      if (!Number.isFinite(detail.fix?.lat) || !Number.isFinite(detail.fix?.lon)) {
        by('nearby-status').textContent = t('waters.location_unavailable');
        return;
      }
      const shapes = await waterDirectory.geography();
      if (!view.active()) return;
      route.distances = waterDistances(atlas.waters, shapes, detail.fix);
      route.limit = pageSize;
      by('nearby-status').textContent = distanceNote;
      results();
    } catch {
      if (view.active()) by('nearby-status').textContent = t('waters.could_not_load_the_water_outlines');
    } finally {
      if (view.active()) by('nearby').disabled = false;
    }
  };
  window.addEventListener('angler-position',receive);
  bind('nearby', () => {
    if (!window.Device?.location) return toast(t('waters.location_unavailable'));
    pending = ++locationRequest;
    by('nearby').disabled = true;
    window.Device.location(pending);
  });
  view.dispose = () => {
    window.removeEventListener('angler-position',receive);
    if (pending) window.Device.cancelLocation(pending);
  };
  function results() {
    const q = Domain.fold(route.query || '');
    const { distances, limit = pageSize } = route;
    const matches = atlas.waters.filter(
      (w) =>
        (!route.additions || route.additions.has(w.code ? w.provider + ':' + w.code : w.key)) &&
        (!route.country || route.country === w.country) && (!route.favorites || isFavorite(pack, w)) &&
        matchesWater(w, q),
    );
    if (distances) matches.sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity));
    by('more-waters').hidden = matches.length <= limit;
    by('all').setAttribute('aria-pressed', String(!route.favorites));
    by('saved').setAttribute('aria-pressed', String(!!route.favorites));
    by('found').textContent = t('waters.waters') + ' · ' + matches.length;
    by('waters').innerHTML =
      matches.slice(0, limit)
        .map(
          (
            w,
          ) => `<article class="water-card"><button type="button" class="water-open" data-water="${esc(w.id)}">
      ${photo(w, 'thumb')}<span class="water-copy"><span class="number">${esc(w.number)}</span><strong>${esc(w.name)}</strong><span class="sub">${esc(w.area)}${distances?.has(w.id) ? ' · ' + distances.get(w.id).toFixed(1) + ' km' : ''}</span></span></button>${favoriteButton(pack, w)}</article>`,
        )
        .join('') ||
      emptyState(
        route.favorites ? 'bookmark' : 'search',
        route.favorites && !q
          ? t('waters.no_favorites_yet')
          : t('waters.no_matching_water'),
        route.favorites && !q
          ? t('waters.use_the_bookmark_beside_a_water_to')
          : t('waters.try_another_number_name_or_town'),
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
    route.country = event.target.value;
    syncFilters();
    by('atlas-sources').hidden = !route.country;
  by('water-coverage').innerHTML = coverage(waterDirectory, route.country);
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
}
function waterActions() {
  return '<div class="quick-actions">' +
    button('new-trip', t('waters.log_a_trip'), 'primary', 'plus') +
    button('open-rules', t('common.seasons_sizes'), 'secondary', 'calendar-days') +
    button('open-activity', t('common.water_activity'), 'secondary') +
    button('open-discussion', t('common.observations_and_questions'), 'secondary') +
    button('water-market', t('waters.offers_on_this_water'), 'secondary') + '</div>';
}

function bindWaterActions(nav, water) {
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
  if (!w) {
    const us = site.provider === 'FWP';
    const publisher = site.publisher || { CRS: t('sources.crs.name'), MRS: t('sources.mrs.name'), FWP: 'Montana Fish, Wildlife & Parks' }[site.provider];
    const types = { section:t('waters.fishing_section'), management:t('waters.fishery_management_area_reference_point'), access:t('waters.fishing_access_site'), fishery: t('waters.fishery'), pond: t('waters.pond'), water: t('waters.water_body') };
    const facts = us ? [t('waters.fishing_access_site'), site.area, site.access.pt.slice().reverse().join(', ')]
      : [site.number, types[site.kind], typeof site.trout === 'boolean' && (site.trout ? t('waters.trout_water') : t('waters.non_trout_water')),
        site.scope, site.status, site.area !== site.scope && site.publisher && site.area, site.licence,
        site.region, site.manager && t('waters.organisation') + ' · ' + site.manager,
        site.acreage && site.acreage + ' ha', site.length && site.length + ' km'];
    screen.innerHTML = back(t('atlas.title')) + '<h1>' + esc(site.name) + '</h1><section class="surface" id="atlas-map"></section><section class="surface">' +
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
    attachAtlasMap(by('atlas-map'), site, waterDirectory, view);
    waterReports(by('water-reports'), site.key, view);
    return;
  }
  const landmark = (mark, text) =>
    `<li><span class="point p${mark === '!' ? 'danger' : mark}">${mark}</span>${esc(text)}</li>`;
  screen.innerHTML =
    back(t('atlas.title')) +
    `<section class="hero detail-hero">${photo(w, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${esc(w.number)} · ${esc(loc(pack.label))}</div><h1>${esc(w.name)}</h1></div>${favoriteButton(pack, w)}</section><p class="area-line">${icon('route')}${esc(w.area)}</p>
    ${waterActions()}
    <div class="columns"><section class="surface">${sectionTitle('map', t('waters.water_map'))}${waterMap(w, rivers, false, true)}<ul class="legend">${landmark('1', loc(w.ends[0]))}${landmark('2', loc(w.ends[1]))}${landmark('!', loc(w.restriction))}${w.access ? landmark('A', loc(w.access)) : ''}</ul></section>
    <section class="surface">${sectionTitle('navigation', t('waters.getting_to_the_water'))}${w.access ? `<p>${esc(loc(w.access))}</p><div class="actions">${button('navigate', t('waters.open_directions'), 'secondary', 'navigation')}</div><div class="rulesrc">${link(w.access.source, t('waters.access_point_source'))}</div>` : `<p class="muted">${t('waters.this_pack_has_no_verified_access_point')}</p>`}</section></div>${credits(w)}`;
  bindBack(nav);
  bindWaterActions(nav, site);
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
