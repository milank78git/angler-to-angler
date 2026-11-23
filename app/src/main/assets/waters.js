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
export function listWaters({ view, pack, nav }) {
  const { route } = view;
  const cover = pack.waters.find((w) => w.id === pack.coverWater) || pack.waters[0];
  screen.innerHTML = `<section class="hero">${photo(cover, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${esc(loc(pack.label))}</div><h1>${t('Atlas revírů', 'Water atlas')}</h1></div>
    <span class="photo-place">${esc(cover?.name || '')}</span></section>
    <div class="catalog-tools"><div class="search-box">${icon('search')}<label class="sr" for="search">${t('Název, číslo revíru nebo obec', 'Name, water number or town')}</label><input type="search" id="search" value="${esc(route.query || '')}" placeholder="${t('Hledat název, číslo nebo obec', 'Search waters, numbers or towns')}"></div>
    <div class="filter-row"><div class="segments">${button('all', t('Všechny', 'All'))}${button('saved', t('Oblíbené', 'Favorites'), '', 'bookmark')}</div><span class="count" id="found" role="status"></span></div></div>
    <div id="waters" class="water-list"></div>${credits(...pack.waters)}`;
  function results() {
    const q = Domain.fold(route.query || '');
    const matches = pack.waters.filter(
      (w) =>
        (!route.favorites || isFavorite(pack, w)) &&
        Domain.fold(w.name + ' ' + w.id + ' ' + w.area).includes(q),
    );
    by('all').setAttribute('aria-pressed', String(!route.favorites));
    by('saved').setAttribute('aria-pressed', String(!!route.favorites));
    by('found').textContent = t('Počet revírů', 'Waters') + ' · ' + matches.length;
    by('waters').innerHTML =
      matches
        .map(
          (
            w,
          ) => `<article class="water-card"><button type="button" class="water-open" data-water="${esc(w.id)}">
      ${photo(w, 'thumb')}<span class="water-copy"><span class="number">${esc(w.number)}</span><strong>${esc(w.name)}</strong><span class="sub">${esc(w.area)}</span></span></button>${favoriteButton(pack, w)}</article>`,
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
            toggleFavorite(pack, b.dataset.favorite);
            results();
            const target = Array.from(by('waters').querySelectorAll('[data-favorite]')).find(
              (el) => el.dataset.favorite === b.dataset.favorite,
            );
            (target || by('saved')).focus({ preventScroll: true });
          }),
      );
  }
  bind('all', () => {
    route.favorites = false;
    results();
  });
  bind('saved', () => {
    route.favorites = true;
    results();
  });
  by('search').oninput = () => {
    route.query = by('search').value;
    results();
  };
  results();
}
export function waterScreen({ view, pack, rivers, nav }) {
  const { route } = view;
  const w = pack.waters.find((x) => x.id === route.id);
  const landmark = (mark, text) =>
    `<li><span class="point p${mark === '!' ? 'danger' : mark}">${mark}</span>${esc(text)}</li>`;
  screen.innerHTML =
    back(t('Atlas revírů', 'Water atlas')) +
    `<section class="hero detail-hero">${photo(w, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${esc(w.number)} · ${esc(loc(pack.label))}</div><h1>${esc(w.name)}</h1></div>${favoriteButton(pack, w)}</section><p class="area-line">${icon('route')}${esc(w.area)}</p>
    <div class="quick-actions">${button('new-trip', t('Zapsat výpravu', 'Log a trip'), 'primary', 'plus')}${button('open-rules', t('Hájení a míry', 'Seasons & sizes'), 'secondary', 'calendar-days')}${button('open-discussion', t('Dotazy u revíru', 'Water questions'), 'secondary')}${button('open-activity', t('Aktivita na revíru', 'Water activity'), 'secondary')}</div>
    <div class="columns"><section class="surface">${sectionTitle('map', t('Mapa revíru', 'Water map'))}${waterMap(w, rivers)}<ul class="legend">${landmark('1', loc(w.ends[0]))}${landmark('2', loc(w.ends[1]))}${landmark('!', loc(w.restriction))}${w.access ? landmark('A', loc(w.access)) : ''}</ul></section>
    <section class="surface">${sectionTitle('navigation', t('Přístup k vodě', 'Getting to the water'))}${w.access ? `<p>${esc(loc(w.access))}</p><div class="actions">${button('navigate', t('Otevřít navigaci', 'Open directions'), 'secondary', 'navigation')}</div><div class="rulesrc">${link(w.access.source, t('Zdroj přístupového bodu', 'Access point source'))}</div>` : `<p class="muted">${t('Pro tento revír chybí ověřený přístupový bod.', 'This pack has no verified access point for this water.')}</p>`}</section></div>${credits(w)}`;
  bindBack(nav);
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
