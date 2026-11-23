import { by, screen, t, cs, bind, button, icon } from './ui.js';
import { Navigation } from './navigation.js';
import { listWaters, waterScreen } from './waters.js';
import { rulesScreen } from './seasons.js';
import { listTrips, tripForm, tripScreen } from './trips.js';
import { catchForm } from './catch-form.js';
const tabs = by('tabs'),
  catalog = {};
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
const nav = new Navigation(
  render,
  () => confirm(t('Zahodit neuložené změny?', 'Discard unsaved changes?')),
  () => window.scrollY,
);

/** The native bridge only needs these three callbacks; feature code stays module scoped. */
window.handleBack = () => nav.back();
window.reminderChanged = () => window.dispatchEvent(new Event('reminderchange'));
window.positionResult = (id, fix) =>
  window.dispatchEvent(new CustomEvent('angler-position', { detail: { id, fix } }));

async function render(view, area) {
  const { page } = view.route;
  const editing = page === 'newTrip' || page === 'newCatch';
  tabs.hidden = editing;
  document.body.classList.toggle('editing', editing);
  for (const key of ['waters', 'rules', 'trips'])
    by('tab' + key).setAttribute('aria-current', area === key ? 'page' : 'false');
  // Retire old interactive nodes before the new screen starts asynchronous reads.
  screen.replaceChildren();
  screen.dataset.page = page;
  screen.setAttribute('aria-busy', 'true');
  try {
    await views[page]({ view, nav, ...catalog });
    if (!view.active()) return;
    const title = screen.querySelector('h1');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      document.title = title.textContent + ' · ' + by('brand').textContent;
    }
    window.scrollTo(0, view.route.scroll || 0);
  } catch (error) {
    if (!view.active()) return;
    console.error('Could not render ' + page, error);
    screen.innerHTML =
      '<p role="alert">' +
      t('Obrazovku se nepodařilo načíst.', 'Could not open this screen.') +
      '</p>' +
      button('retry', t('Zkusit znovu', 'Retry'));
    bind('retry', () => nav.show());
  } finally {
    if (view.active()) screen.removeAttribute('aria-busy');
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
    [catalog.pack, catalog.rivers] = await Promise.all(
      ['catalog.json', 'rivers.json'].map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw Error(path);
        return response.json();
      }),
    );

    const destinations = [
      ['waters', t('Revíry', 'Waters'), 'map'],
      ['rules', t('Hájení', 'Seasons'), 'calendar-days'],
      ['trips', t('Deník', 'Journal'), 'book-open'],
    ];
    tabs.setAttribute('aria-label', t('Hlavní navigace', 'Main navigation'));
    tabs.innerHTML = destinations
      .map(([k, label, glyph]) => button('tab' + k, label, 'destination', glyph))
      .join('');
    destinations.forEach(([k]) => bind('tab' + k, () => nav.open(k)));
    nav.show();
  } catch (error) {
    screen.textContent = t(
      'Místní data se nepodařilo otevřít. Zkus aplikaci znovu spustit.',
      'Could not open local data. Try restarting the app.',
    );
  }
}
window.addEventListener('DOMContentLoaded', start);
