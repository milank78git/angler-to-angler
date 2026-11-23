'use strict';
const screen = document.querySelector('#screen'),
  tabs = document.querySelector('#tabs');
const cs = (window.Device ? Device.locale() : navigator.language).toLowerCase().startsWith('cs');
const t = (cz, en) => (cs ? cz : en),
  loc = (obj) => obj[cs ? 'cs' : 'en'];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const by = (id) => document.getElementById(id);
const options = (pairs, sel) =>
  pairs
    .map(
      ([val, label]) =>
        '<option value="' +
        esc(val) +
        '"' +
        (val === sel ? ' selected' : '') +
        '>' +
        esc(label) +
        '</option>',
    )
    .join('');
function bind(id, fn) {
  by(id).onclick = fn;
}
function toast(message) {
  by('notice').textContent = message;
  by('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (by('notice').hidden = true), 4600);
}
let pack,
  rivers,
  draft = false,
  noticeTimer,
  viewVersion = 0,
  disposeView = () => {};
let area = 'waters';
const stacks = Object.fromEntries(['waters', 'rules', 'trips'].map((page) => [page, [{ page }]]));
let route = stacks.waters[0];
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" focusable="false"><use href="icons.svg#${name}"></use></svg>`;
const button = (id, label, cls = '', glyph = '') =>
  `<button id="${id}" type="button" class="${cls}">${glyph ? icon(glyph) : ''}<span>${esc(label)}</span></button>`;
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;
const sectionTitle = (glyph, label) => `<h2 class="section-title">${icon(glyph)}${esc(label)}</h2>`;
const emptyState = (glyph, title, body = '') =>
  `<div class="empty">${icon(glyph)}<strong>${esc(title)}</strong>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
const back = (label) => button('back', label, 'back', 'arrow-left');
function bindBack() {
  bind('back', handleBack);
}
function mayLeave() {
  return !draft || confirm(t('Zahodit neuložené změny?', 'Discard unsaved changes?'));
}
/** Each top-level destination owns its history, including search filters and scroll position. */
function remember() {
  route.scroll = window.scrollY;
  disposeView();
  disposeView = () => {};
  draft = false;
}
function go(page, props = {}) {
  if (!mayLeave()) return;
  remember();
  if (Object.prototype.hasOwnProperty.call(stacks, page)) {
    if (area === page) stacks[area] = [{ page }];
    area = page;
  } else {
    stacks[area].push({ page, ...props });
  }
  paint();
}
function showSavedTrip(id) {
  remember();
  if (area !== 'trips' && route.page === 'newTrip') stacks[area].pop();
  area = 'trips';
  stacks.trips = [{ page: 'trips' }, { page: 'trip', id }];
  paint();
}
function handleBack() {
  if (stacks[area].length === 1 && area === 'waters') return false;
  if (!mayLeave()) return true;
  remember();
  if (stacks[area].length > 1) stacks[area].pop();
  else area = 'waters';
  paint();
  return true;
}
async function paint() {
  route = stacks[area][stacks[area].length - 1];
  const version = ++viewVersion;
  const editing = route.page === 'newTrip' || route.page === 'newCatch';
  tabs.hidden = editing;
  document.body.classList.toggle('editing', editing);
  Object.keys(stacks).forEach((key) => {
    const el = by('tab' + key);
    el.setAttribute('aria-current', area === key ? 'page' : 'false');
  });
  screen.dataset.page = route.page;
  const views = {
    waters: listWaters,
    water: waterScreen,
    rules: rulesScreen,
    waterRules: rulesScreen,
    trips: listTrips,
    trip: tripScreen,
    newTrip: tripForm,
    newCatch: catchForm,
  };
  try {
    await views[route.page]();
    if (version !== viewVersion) return;
    const h = screen.querySelector('h1');
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
      document.title = h.textContent + ' · ' + by('brand').textContent;
    }
    window.scrollTo(0, route.scroll || 0);
  } catch (error) {
    if (version === viewVersion) toast(t('Obrazovku se nepodařilo načíst.', 'Could not open this screen.'));
  }
}
function setTheme(mode) {
  const dark = mode === 'dark';
  document.documentElement.dataset.theme = mode;
  by('theme').setAttribute(
    'aria-label',
    dark ? t('Zapnout světlý vzhled', 'Use light theme') : t('Zapnout tmavý vzhled', 'Use dark theme'),
  );
  by('theme').innerHTML = icon(dark ? 'sun' : 'moon');
  if (window.Device && typeof Device.systemBars === 'function') Device.systemBars(dark);
}
async function start() {
  document.documentElement.lang = cs ? 'cs' : 'en';
  by('brand').textContent = t('Rybáři sobě', 'Angler to Angler');
  by('mark').innerHTML = icon('fish-symbol');
  by('offline').innerHTML = icon('check') + t('Offline podklady', 'Offline pack');
  const system = matchMedia('(prefers-color-scheme: dark)');
  const sync = () =>
    setTheme(
      localStorage.getItem('ui.theme') ||
        ((window.Device ? Device.nightMode() : system.matches) ? 'dark' : 'light'),
    );
  sync();
  if (system.addEventListener) system.addEventListener('change', sync);
  else system.addListener(sync);
  bind('theme', () => {
    const mode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ui.theme', mode);
    setTheme(mode);
  });
  try {
    [pack, rivers] = await Promise.all(
      ['catalog.json', 'rivers.json'].map((p) => fetch(p).then((r) => r.json())),
    );
    await Journal.open();
    const nav = [
      ['waters', t('Revíry', 'Waters'), 'map'],
      ['rules', t('Hájení', 'Seasons'), 'calendar-days'],
      ['trips', t('Deník', 'Journal'), 'book-open'],
    ];
    tabs.setAttribute('aria-label', t('Hlavní navigace', 'Main navigation'));
    tabs.innerHTML = nav
      .map(([k, label, glyph]) => button('tab' + k, label, 'destination', glyph))
      .join('');
    nav.forEach(([k]) => bind('tab' + k, () => go(k)));
    await paint();
  } catch (error) {
    screen.textContent = t(
      'Místní data se nepodařilo otevřít. Zkus aplikaci znovu spustit.',
      'Could not open local data. Try restarting the app.',
    );
  }
}
window.addEventListener('DOMContentLoaded', start);
