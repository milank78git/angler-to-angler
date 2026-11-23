import { by, screen, t, cs, bind, button, icon, confirmAction, dismissConfirmation } from './ui.js';
import { Navigation } from './navigation.js';
import { listWaters, waterScreen } from './waters.js';
import { rulesScreen } from './seasons.js';
import { listTrips, tripForm, tripScreen } from './trips.js';
import { catchForm } from './catch-form.js';
import { weeklyGroups, weeklyBoard } from './weekly-catch.js';
import { messageInbox, messageThread, messageComposer } from './messages.js';
import { waterDiscussion, discussionComposer } from './discussion.js';
import { shareCard } from './share-card.js';
import { profileScreen, editProfile, directoryScreen } from './profiles.js';
import { evidenceScreen, reviewScreen } from './verification.js';
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
  shareCard,
  weeklyGroups,
  weeklyBoard,
  messageInbox,
  messageThread,
  messageComposer,
  waterDiscussion,
  discussionComposer,
  anglerProfile: profileScreen,
  editProfile,
  directory: directoryScreen,
  evidence: evidenceScreen,
  review: reviewScreen,
};
const nav = new Navigation(
  render,
  () =>
    confirmAction({
      title: t('Zahodit neuložené změny?', 'Discard unsaved changes?'),
      message: t('Po odchodu se změny z tohoto formuláře ztratí.', 'Leaving this form will discard your edits.'),
      accept: t('Zahodit změny', 'Discard changes'),
      destructive: true,
    }),
  () => window.scrollY,
);

/** Forward native navigation and device events to the current screen. */
window.handleBack = () => dismissConfirmation() || nav.back();
window.reminderChanged = () => window.dispatchEvent(new Event('reminderchange'));
window.positionResult = (id, fix) =>
  window.dispatchEvent(new CustomEvent('angler-position', { detail: { id, fix } }));

async function render(view, area) {
  dismissConfirmation();
  const { page } = view.route;
  const editing = ['newTrip', 'newCatch', 'editProfile', 'discussionComposer', 'messageComposer'].includes(page);
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
  if (window.Device && typeof Device.systemBars === 'function')
    Device.systemBars(dark, !!localStorage.getItem('ui.theme'));
}
async function start() {
  document.documentElement.lang = cs ? 'cs' : 'en';
  by('profile').textContent = t('Profil', 'Profile');
  bind('profile', () => {
    if (nav.current?.route.page !== 'anglerProfile' || nav.current.route.id) nav.open('anglerProfile');
  });
  by('brand').textContent = t('Rybáři sobě', 'Angler to Angler');
  const versionLabel = window.Device?.versionLabel?.();
  if (versionLabel) {
    by('app-version').textContent = versionLabel;
    by('app-version').hidden = false;
  }
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
    const weekly = window.Device?.weeklyDestination?.();
    if (weekly) nav.open('weeklyBoard', { ...JSON.parse(weekly), onExit: () => window.Device.closeGroupBoard() });
    else if (window.Device?.openProfile?.()) nav.open('anglerProfile');
    else nav.show();
  } catch (error) {
    screen.textContent = t(
      'Místní data se nepodařilo otevřít. Zkus aplikaci znovu spustit.',
      'Could not open local data. Try restarting the app.',
    );
  }
}
window.addEventListener('DOMContentLoaded', start);
