'use strict';
/** Projects coordinates at local latitude using equal horizontal and vertical distance scales. */
function waterMap(w) {
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
  const path = lines
    .map(
      (line) =>
        '<polyline points="' +
        line.map((p) => xy(p).join(',')).join(' ') +
        '" fill="none" stroke="#57978d" stroke-width="5" stroke-linejoin="round"/>',
    )
    .join('');
  function marker(p, text, color) {
    const [x, y] = xy(p);
    return (
      '<g transform="translate(' +
      x +
      ' ' +
      y +
      ')"><circle r="9" fill="' +
      color +
      '" stroke="white" stroke-width="1.7"/><text y="3.8" text-anchor="middle" fill="white" font-size="11" font-weight="bold">' +
      text +
      '</text></g>'
    );
  }
  return (
    '<figure><svg aria-label="' +
    t('Orientační mapa toku a hranic', 'Overview of river and boundary points') +
    '" role="img" viewBox="0 0 340 170"><defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#cbd8cd" stroke-width=".8"/></pattern></defs><rect width="340" height="170" fill="url(#grid)"/>' +
    path +
    marker(w.bounds[0], '1', '#294f43') +
    marker(w.bounds[1], '2', '#294f43') +
    marker(w.danger, '!', '#9c4736') +
    (w.access ? marker(w.access.pt, 'A', '#33668c') : '') +
    '<text x="315" y="21" font-size="12" fill="#476554">↑ N</text></svg><figcaption>' +
    link('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors · ODbL') +
    '</figcaption></figure>'
  );
}
function ruleResult(w) {
  const section = by('section').value,
    s = by('species').value,
    day = by('rule-date').value;
  const status = Domain.season(pack, s, section, day);
  const labels = {
    closed: t('Ryba je hájená', 'Closed season'),
    outside: t('Mimo uvedenou dobu hájení', 'Outside the listed closed season'),
    unknown: t('Pro tuto volbu chybí ověřené pravidlo', 'No verified rule for this selection'),
    prohibited: t('V tomto úseku je lov zakázán', 'Fishing is prohibited in this section'),
  };
  const valid = status === 'closed' || status === 'outside';
  const windowLabel = pack.species[s].window
    .map((d) =>
      new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date('2000-' + d + 'T12:00Z')),
    )
    .join(' – ');
  by('status').innerHTML =
    '<div class="panel result ' +
    status +
    '"><strong>' +
    icon(
      { closed: 'calendar-off', prohibited: 'ban', unknown: 'circle-help', outside: 'calendar-days' }[
        status
      ],
    ) +
    labels[status] +
    '</strong>' +
    (valid
      ? '<p>' +
        windowLabel +
        (w.size[s] ? ' · ' + t('nejmenší míra', 'minimum size') + ' ' + w.size[s] + ' cm' : '') +
        '</p>'
      : '') +
    '</div>';
  const key = pack.id + '/' + w.id + '/' + s;
  by('watch').innerHTML = '';
  if (!window.Device || section !== 'main') return;
  const watching = Device.watching(key),
    today = Domain.today(pack.zone);
  if (!watching && (today > pack.until || today < pack.from)) return;
  by('watch').innerHTML =
    button(
      'watch-toggle',
      watching
        ? t('Vypnout připomínky', 'Stop reminders')
        : t('Připomínat změny hájení', 'Remind me of season changes'),
    ) +
    '<p class="meta">' +
    t(
      'Pro hlavní tok. Telefon připomene také konec platnosti podkladů.',
      'For the main river. Includes a reminder when the local rules pack expires.',
    ) +
    '</p>';
  bind('watch-toggle', () => Device.reminder(key, !watching));
}
function reminderChanged() {
  if (['rules', 'waterRules'].includes(route.page)) ruleResult(pack.waters.find((w) => w.id === route.id));
}
/** Render only verified regional facts, offline photos and optional access points. */
function isFavorite(w) {
  return localStorage.getItem(`water.${pack.id}.${w.id}`) === '1';
}
function favoriteButton(w) {
  const saved = isFavorite(w);
  const label = saved
    ? t('Odebrat z oblíbených', 'Remove from favorites')
    : t('Uložit do oblíbených', 'Save to favorites');
  return `<button class="icon-btn favorite" type="button" data-favorite="${esc(w.id)}" aria-label="${esc(label + ' · ' + w.name)}" aria-pressed="${saved}">${icon('bookmark')}</button>`;
}
function toggleFavorite(id) {
  const w = pack.waters.find((x) => x.id === id);
  const key = `water.${pack.id}.${id}`;
  if (isFavorite(w)) localStorage.removeItem(key);
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
function listWaters() {
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
        (!route.favorites || isFavorite(w)) && Domain.fold(w.name + ' ' + w.id + ' ' + w.area).includes(q),
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
      ${photo(w, 'thumb')}<span class="water-copy"><span class="number">${esc(w.number)}</span><strong>${esc(w.name)}</strong><span class="sub">${esc(w.area)}</span></span></button>${favoriteButton(w)}</article>`,
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
      .forEach((b) => (b.onclick = () => go('water', { id: b.dataset.water })));
    by('waters')
      .querySelectorAll('[data-favorite]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            toggleFavorite(b.dataset.favorite);
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
function waterScreen() {
  const w = pack.waters.find((x) => x.id === route.id);
  const landmark = (mark, text) =>
    `<li><span class="point p${mark === '!' ? 'danger' : mark}">${mark}</span>${esc(text)}</li>`;
  screen.innerHTML =
    back(t('Atlas revírů', 'Water atlas')) +
    `<section class="hero detail-hero">${photo(w, 'hero-img')}<div class="hero-copy"><div class="hero-meta">${icon('map-pin')}${esc(w.number)} · ${esc(loc(pack.label))}</div><h1>${esc(w.name)}</h1></div>${favoriteButton(w)}</section><p class="area-line">${icon('route')}${esc(w.area)}</p>
    <div class="quick-actions">${button('new-trip', t('Zapsat výpravu', 'Log a trip'), 'primary', 'plus')}${button('open-rules', t('Hájení a míry', 'Seasons & sizes'), 'secondary', 'calendar-days')}</div>
    <div class="columns"><section class="surface">${sectionTitle('map', t('Mapa revíru', 'Water map'))}${waterMap(w)}<ul class="legend">${landmark('1', loc(w.ends[0]))}${landmark('2', loc(w.ends[1]))}${landmark('!', loc(w.restriction))}${w.access ? landmark('A', loc(w.access)) : ''}</ul></section>
    <section class="surface">${sectionTitle('navigation', t('Přístup k vodě', 'Getting to the water'))}${w.access ? `<p>${esc(loc(w.access))}</p><div class="actions">${button('navigate', t('Otevřít navigaci', 'Open directions'), 'secondary', 'navigation')}</div><div class="rulesrc">${link(w.access.source, t('Zdroj přístupového bodu', 'Access point source'))}</div>` : `<p class="muted">${t('Pro tento revír chybí ověřený přístupový bod.', 'This pack has no verified access point for this water.')}</p>`}</section></div>${credits(w)}`;
  bindBack();
  bind('new-trip', () => go('newTrip', { water: w.id }));
  bind('open-rules', () => go('waterRules', { id: w.id }));
  const fav = screen.querySelector('[data-favorite]');
  fav.onclick = () => {
    toggleFavorite(w.id);
    fav.setAttribute('aria-pressed', String(isFavorite(w)));
    fav.setAttribute(
      'aria-label',
      (isFavorite(w)
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
function rulesScreen() {
  const w = pack.waters.find((x) => x.id === route.id) || pack.waters[0],
    contextual = route.page === 'waterRules';
  route.id = w.id;
  const selectRow = (id, label, items, selected) =>
    `<label for="${id}">${esc(label)}</label><select id="${id}">${options(items, selected)}</select>`;
  const species = Object.entries(pack.species).map(([key, v]) => [key, loc(v)]);
  screen.innerHTML =
    (contextual ? back(w.name) : '') +
    `<div class="page-intro"><div class="title-mark">${icon('calendar-days')}</div><h1>${t('Hájení a míry', 'Seasons & sizes')}</h1></div><div class="columns"><section class="surface">
    ${selectRow(
      'rule-water',
      t('Revír', 'Water'),
      pack.waters.map((v) => [v.id, v.name]),
      w.id,
    )}
    ${selectRow(
      'section',
      t('Úsek', 'Section'),
      [
        ['main', t('Hlavní tok', 'Main river')],
        ['restricted', loc(w.restriction)],
        ['other', t('Jiný úsek / přítok', 'Other section / tributary')],
      ],
      route.section || 'main',
    )}
    <div class="pair"><div>${selectRow('species', t('Druh ryby', 'Fish species'), species, route.species || species[0][0])}</div><div><label for="rule-date">${t('Datum lovu', 'Fishing date')}</label><input id="rule-date" type="date" value="${esc(route.day || Domain.today(pack.zone))}"></div></div></section>
    <div><div id="status" aria-live="polite"></div><div id="watch"></div></div></div>
    <details class="fold"><summary>${icon('info')}${t('Platnost a zdroje', 'Coverage and sources')}</summary><div class="fold-body"><p>${t('Zobrazené pravidlo pokrývá vybraný druh a úsek. Ověř si i další místní omezení.', 'The selected rule covers this species and section. Check other local restrictions.')}</p><p class="sub">${t('Ověřeno', 'Checked')} ${esc(displayDay(pack.revision))} · ${t('Platí do', 'Valid through')} ${esc(displayDay(pack.until))}</p><div class="rulesrc">${link(w.source, t('Karta revíru ČRS', 'Fishery authority'))}${link(pack.law, t('Vyhláška · § 13', 'National closed seasons'))}</div></div></details>`;
  if (contextual) {
    bindBack();
    by('rule-water').disabled = true;
  }
  by('rule-water').onchange = () => {
    route.id = by('rule-water').value;
    route.section = 'main';
    rulesScreen();
    by('rule-water').focus();
  };
  for (const key of ['section', 'species', 'rule-date'])
    by(key).onchange = () => {
      route.section = by('section').value;
      route.species = by('species').value;
      route.day = by('rule-date').value;
      ruleResult(w);
    };
  ruleResult(w);
}
