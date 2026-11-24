import { countryName } from './fish-catalogue.js';
import { waterDistances } from './water-directory.js';
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
export function waterMap(w, rivers, boundariesOnly = false) {
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
  return `<figure><svg aria-label="${t('Orientační mapa toku a hranic', 'Overview of river and boundary points')}" role="img" viewBox="0 0 340 170">
    <defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#cbd8cd" stroke-width=".8"/></pattern></defs>
    <rect width="340" height="170" fill="url(#grid)"/>${paths.join('')}
    ${marker(w.bounds[0], '1', '#294f43')}${marker(w.bounds[1], '2', '#294f43')}${boundariesOnly ? '' : marker(w.danger, '!', '#9c4736')}
    ${w.access && !boundariesOnly ? marker(w.access.pt, 'A', '#33668c') : ''}<text x="315" y="21" font-size="12" fill="#476554">↑ N</text>
    </svg><figcaption>${link('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors · ODbL')}</figcaption></figure>`;
}
function isFavorite(pack, w) {
  return localStorage.getItem(`water.${window.Device.subjectId()}.${pack.id}.${w.id}`) === '1';
}
function favoriteButton(pack, w) {
  const saved = isFavorite(pack, w);
  const label = saved
    ? t('Odebrat z oblíbených', 'Remove from favorites')
    : t('Uložit do oblíbených', 'Save to favorites');
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
  return `<details class="credits"><summary>${icon('image')}${t('Fotografie a licence', 'Photo credits')}</summary>${rows.join('')}<p>${t('Zmenšeno a oříznuto.', 'Resized and cropped.')}</p></details>`;
}
let locationRequest = 2000000;

/** Describe the published geographic scope even for countries without an offline edition. */
function coverage(directory, country) {
  if (!country) return '';
  const links = [];
  if (country === 'CZ') links.push(link('https://ris.rybsvaz.cz/soupisy','ČRS'),link('https://mrsbrno.cz/reviry','MRS'));
  if (country === 'US') links.push(link('https://fwp.mt.gov/fish/fishing-access','Montana FWP'));
  const providers = Object.values(directory.sources.providers).filter(p => p.country === country);
  links.push(...providers.map(p => link(p.url, p.label + ' · ' + p.scope)));
  const local = directory.sources.directories[country];
  if (local) links.push(link(local[1], local[0]));
  const rules = directory.countries[country];
  if (rules) links.push(link(rules.authority || rules.url, t('Informace k rybolovu v zemi','National fishing information')));
  const missing = !providers.length && !['CZ','US'].includes(country);
  return (missing ? '<p>' + t('Offline soupis pro tuto zemi zatím chybí. Otevři zdroj níže.', 'An offline directory is not yet available for this country. Open the source below.') + '</p>' : '')
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
  screen.innerHTML = `<section class="hero">${photo(cover, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${t('Česko a zahraničí', 'Czechia and abroad')}</div><h1>${t('Atlas revírů', 'Water atlas')}</h1></div>
    <span class="photo-place">${esc(cover?.name || '')}</span></section>
    <div class="quick-actions home-features">${button('home-market', t('Tržiště tipů', 'Tip market'), 'primary')}${button('home-fish', t('Katalog ryb', 'Fish catalogue'), 'secondary', 'fish-symbol')}</div>
    <div class="actions">${button('nearby',t('Seřadit podle polohy','Sort by location'),'secondary')}</div><p id="nearby-status" role="status"></p>
    <div class="actions">${button('atlas-settings',t('Aktualizace atlasu revírů','Water atlas updates'),'secondary')}</div>
    <div class="catalog-tools"><div class="search-box">${icon('search')}<label class="sr" for="search">${t('Název, číslo revíru nebo obec', 'Name, water number or town')}</label><input type="search" id="search" value="${esc(route.query || '')}" placeholder="${t('Hledat název, číslo nebo obec', 'Search waters, numbers or towns')}"></div>
    ${selectField('water-country', t('Země revíru', 'Fishery country'), [
      ['', t('Všechny země', 'All countries')], ...countries
    ], route.country || '')}<div id="water-coverage"></div>
    <div class="filter-row"><div class="segments">${button('all', t('Všechny', 'All'))}${button('saved', t('Oblíbené', 'Favorites'), '', 'bookmark')}</div><span class="count" id="found" role="status"></span></div></div>
    <div id="waters" class="water-list"></div>${button('more-waters', t('Zobrazit další revíry', 'Show more waters'), 'secondary')}${credits(...pack.waters)}`;
  bind('atlas-settings', () => window.Device?.openWaterSettings?.());
  bind('home-market', () => nav.open('marketShelf'));
  bind('home-fish', () => nav.open('fishCatalogue'));
  const pageSize = 40;
  let pending;
  const distanceNote = t('Orientační vzdálenost k mapované ploše, úseku nebo nejbližšímu zveřejněnému bodu. Revíry bez polohy jsou na konci.',
    'Approximate distance to the mapped water, section or nearest published point. Waters without a location appear last.');
  if (route.distances) by('nearby-status').textContent = distanceNote;
  const receive = async ({ detail }) => {
    if (!pending || detail.id !== pending) return;
    pending = null;
    try {
      if (!Number.isFinite(detail.fix?.lat) || !Number.isFinite(detail.fix?.lon)) {
        by('nearby-status').textContent = t('Poloha není dostupná.', 'Location unavailable.');
        return;
      }
      const shapes = await waterDirectory.geography();
      if (!view.active()) return;
      route.distances = waterDistances(atlas.waters, shapes, detail.fix);
      route.limit = pageSize;
      by('nearby-status').textContent = distanceNote;
      results();
    } catch {
      if (view.active()) by('nearby-status').textContent = t('Mapové podklady se nepodařilo načíst.', 'Could not load the water outlines.');
    } finally {
      if (view.active()) by('nearby').disabled = false;
    }
  };
  window.addEventListener('angler-position',receive);
  bind('nearby', () => {
    if (!window.Device?.location) return toast(t('Poloha není dostupná.', 'Location unavailable.'));
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
        (!route.country || route.country === w.country) && (!route.favorites || isFavorite(pack, w)) &&
        Domain.fold([w.name, w.number, w.area, w.manager].filter(Boolean).join(' ')).includes(q),
    );
    if (distances) matches.sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity));
    by('more-waters').hidden = matches.length <= limit;
    by('all').setAttribute('aria-pressed', String(!route.favorites));
    by('saved').setAttribute('aria-pressed', String(!!route.favorites));
    by('found').textContent = t('Počet revírů', 'Waters') + ' · ' + matches.length;
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
          ? t('Zatím žádné oblíbené revíry', 'No favorites yet')
          : t('Žádný odpovídající revír', 'No matching water'),
        route.favorites && !q
          ? t('Revír si uložíš záložkou vedle jeho názvu.', 'Use the bookmark beside a water to save it.')
          : t('Zkus jiné číslo, název nebo obec.', 'Try another number, name or town.'),
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
  by('water-coverage').innerHTML = coverage(waterDirectory, route.country);
  results();
}
export function waterScreen({ view, pack, rivers, nav, waterDirectory }) {
  const { route } = view;
  const w = pack.waters.find((x) => x.id === route.id);
  if (!w) {
    const site = waterDirectory.byId.get(route.id);
    if (!site) return nav.back();
    const us = site.provider === 'FWP';
    const publisher = site.publisher || { CRS: 'Český rybářský svaz', MRS: 'Moravský rybářský svaz', FWP: 'Montana Fish, Wildlife & Parks' }[site.provider];
    const types = { section:t('Rybářský úsek', 'Fishing section'), management:t('Rybářská oblast · orientační bod','Fishery management area · reference point'), access:t('Přístupové místo pro rybolov', 'Fishing access site'), fishery: t('Rybářský revír', 'Fishery'), pond: t('Rybník', 'Pond'), water: t('Vodní plocha', 'Water body') };
    const facts = us ? [t('Přístupové místo pro rybolov', 'Fishing access site'), site.area, site.access.pt.slice().reverse().join(', ')]
      : [site.number, types[site.kind], typeof site.trout === 'boolean' && (site.trout ? t('Pstruhový', 'Trout water') : t('Mimopstruhový', 'Non-trout water')),
        site.scope, site.status, site.area !== site.scope && site.publisher && site.area, site.licence,
        site.region, site.manager && t('Organizace', 'Organisation') + ' · ' + site.manager,
        site.acreage && site.acreage + ' ha', site.length && site.length + ' km'];
    screen.innerHTML = back(t('Atlas revírů', 'Water atlas')) + '<h1>' + esc(site.name) + '</h1><section class="surface">' +
      sectionTitle('map', t('Oficiální údaje', 'Official details')) +
      facts.filter(Boolean).map(value => '<p>' + esc(value) + '</p>').join('') + link(site.source, publisher) +
      (us ? '' : '<p class="meta">' + t('Datum importu', 'Imported on') + ' · ' + esc(site.asOf || waterDirectory.asOf) + '</p>' +
        (site.mapped ? '<p>' + t('Pro řazení podle polohy se používá zveřejněný obrys vody.', 'Nearby sorting uses the published water outline.') + '</p>' :
          site.lines ? '<p>' + t('Pro řazení se používá zveřejněný průběh úseku.', 'Nearby sorting uses the published course of the section.') + '</p>' :
          site.points ? '<details><summary>' + t('Polohové body', 'Published coordinates') + ' (' + site.points.length + ')</summary>' +
            site.points.map(([lon, lat]) => '<p>' + esc(lat) + ', ' + esc(lon) + '</p>').join('') + '</details>' :
            '<p>' + t('Pro tento revír chybí poloha v offline atlasu.', 'This water has no location in the offline atlas.') + '</p>')) +
      '</section><div class="actions">' + button('open-discussion', t('Informace od rybářů', 'Angler contributions'), 'secondary') +
      (us ? '' : button('water-market', t('Nabídky na revíru', 'Offers on this water'), 'secondary')) +
      '</div><section class="surface"><h2>' + t('Hlášení od vody', 'Water reports') + '</h2><div id="water-reports"></div></section>';
    bindBack(nav);
    bind('open-discussion', () => nav.open('waterDiscussion', { id: site.id }));
    if (!us) bind('water-market', () => nav.open('marketShelf', { water: site.key }));
    waterReports(by('water-reports'), site.key, view);
    return;
  }
  const landmark = (mark, text) =>
    `<li><span class="point p${mark === '!' ? 'danger' : mark}">${mark}</span>${esc(text)}</li>`;
  screen.innerHTML =
    back(t('Atlas revírů', 'Water atlas')) +
    `<section class="hero detail-hero">${photo(w, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${esc(w.number)} · ${esc(loc(pack.label))}</div><h1>${esc(w.name)}</h1></div>${favoriteButton(pack, w)}</section><p class="area-line">${icon('route')}${esc(w.area)}</p>
    <div class="quick-actions">${button('water-market',t('Nabídky na revíru','Offers on this water'),'secondary')}${button('new-trip', t('Zapsat výpravu', 'Log a trip'), 'primary', 'plus')}${button('open-rules', t('Hájení a míry', 'Seasons & sizes'), 'secondary', 'calendar-days')}${button('open-discussion', t('Poznatky a dotazy', 'Observations and questions'), 'secondary')}${button('open-activity', t('Aktivita na revíru', 'Water activity'), 'secondary')}</div>
    <div class="columns"><section class="surface">${sectionTitle('map', t('Mapa revíru', 'Water map'))}${waterMap(w, rivers)}<ul class="legend">${landmark('1', loc(w.ends[0]))}${landmark('2', loc(w.ends[1]))}${landmark('!', loc(w.restriction))}${w.access ? landmark('A', loc(w.access)) : ''}</ul></section>
    <section class="surface">${sectionTitle('navigation', t('Přístup k vodě', 'Getting to the water'))}${w.access ? `<p>${esc(loc(w.access))}</p><div class="actions">${button('navigate', t('Otevřít navigaci', 'Open directions'), 'secondary', 'navigation')}</div><div class="rulesrc">${link(w.access.source, t('Zdroj přístupového bodu', 'Access point source'))}</div>` : `<p class="muted">${t('Pro tento revír chybí ověřený přístupový bod.', 'This pack has no verified access point for this water.')}</p>`}</section></div>${credits(w)}`;
  bindBack(nav);
  const waterKey = pack.country + ':' + w.id;
  screen.insertAdjacentHTML('beforeend','<section class="surface"><h2>'+t('Hlášení od vody','Water reports')+'</h2><div id="water-reports"></div></section>');
  waterReports(by('water-reports'),waterKey,view);
  by('water-reports').parentElement.insertAdjacentHTML('beforebegin',link(w.source,t('Oficiální karta revíru','Official fishery record')));
  const marketButton = by('water-market');
  bind('water-market', () => nav.open('marketShelf', { water: waterKey }));
  // Availability is online. The atlas and the link remain usable while counts load or fail.
  rpc('market_discover', { water_key: waterKey, before_position: null }).then(result => {
    if (view.active()) marketButton.querySelector('span').textContent += ' (' + result.stats.offers + ')';
  }).catch(() => {
    if (view.active()) marketButton.querySelector('span').textContent += ' · ' + t('Počet nedostupný','Count unavailable');
  });
  bind('new-trip', () => nav.open('newTrip', { water: w.id }));
  bind('open-activity', () => nav.open('waterActivity', { id: w.id }));
  bind('open-discussion', () => nav.open('waterDiscussion', { id: w.id }));
  bind('open-rules', () => nav.open('waterRules', { id: w.id }));
  const fav = screen.querySelector('[data-favorite]');
  fav.onclick = () => {
    toggleFavorite(pack, w.id);
    fav.setAttribute('aria-pressed', String(isFavorite(pack, w)));
    fav.setAttribute(
      'aria-label',
      (isFavorite(pack, w)
        ? t('Odebrat z oblíbených', 'Remove from favorites')
        : t('Uložit do oblíbených', 'Save to favorites')) +
        ' · ' +
        w.name,
    );
  };
  if (w.access)
    bind('navigate', () =>
      window.Device
        ? Device.navigate(w.access.pt[1], w.access.pt[0])
        : toast(t('Navigace je dostupná v aplikaci pro Android.', 'Directions are available on Android.')),
    );
}
