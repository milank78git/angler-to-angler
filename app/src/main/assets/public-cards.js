import { Journal, newJournalId } from './journal.js';
import { photoPayload, rpc } from './profile-api.js';
import { competitionPhoto } from './photo.js';
import { renderPublicCard } from './public-card-view.js';
import {
  back,
  bind,
  bindBack,
  button,
  by,
  confirmAction,
  cs,
  esc,
  link,
  loc,
  screen,
  submitChange,
  t,
  toast,
} from './ui.js';

const title = () => t('Veřejná karta úlovku', 'Public catch card');
const mine = () => t('Moje veřejné karty', 'My public cards');
const checkbox = (id, label) =>
  '<label class="card-option"><input type="checkbox" id="' + id + '">' + esc(label) + '</label>';

function message(error) {
  if (error.status === 409)
    return t(
      'Údaje nebo odkaz se změnily. Obnov náhled.',
      'The details or link changed. Refresh the preview.',
    );
  if (error.status === 401 || error.status === 403)
    return t('Pro správu karet se znovu přihlas.', 'Sign in again to manage cards.');
  if (error.status === 422 || error.status === 400)
    return t('Zkontroluj datum, druh ryby a vybranou fotku.', 'Check the date, species and selected photo.');
  return t(
    'Služba je nedostupná. Zkontroluj připojení a zkus to znovu.',
    'Service unavailable. Check your connection and retry.',
  );
}

function failed(view, nav, error) {
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    title() +
    '</h1><p role="alert">' +
    message(error) +
    '</p>' +
    button('refresh-public', t('Obnovit', 'Refresh'), 'secondary');
  bindBack(nav);
  bind('refresh-public', () => nav.show());
}

function linkControls(host, item, view, nav) {
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash !== '#' + item.id)
    throw Error('Invalid public link');
  const group = document.createElement('div');
  group.className = 'actions';
  group.innerHTML = link(url.href, t('Otevřít veřejnou kartu', 'Open public card'));
  const add = (label, cls, action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    btn.onclick = action;
    group.append(btn);
  };
  add(t('Sdílet odkaz', 'Share link'), 'secondary', () => {
    if (!window.Device.shareCatch(url.href, ''))
      toast(t('Sdílení se nepodařilo otevřít.', 'Could not open sharing.'));
  });
  const remove = t('Zneplatnit odkaz', 'Revoke link');
  add(remove, 'danger', async () => {
    if (
      !(await confirmAction({
        title: remove + '?',
        message: t(
          'Tato adresa přestane zobrazovat úlovek všem příjemcům.',
          'This address will stop showing the catch to every recipient.',
        ),
        accept: remove,
        destructive: true,
      })) ||
      !view.active()
    )
      return;
    await submitChange(
      view,
      () => rpc('public_card_withdraw', { link_id: item.id }),
      () => {
        delete view.route.requestId;
        nav.show();
      },
      (err) => toast(message(err)),
    );
  });
  host.append(group);
}

/** Source data stay in the journal until the user confirms the exact preview. */
export async function publicCardEditor({ view, nav, pack }) {
  const { tripId, catchId } = view.route;
  let trip, entry, options, waterKey;
  try {
    [trip, entry] = await Promise.all([Journal.trip(tripId), Journal.catchById(catchId)]);
    if (!view.active()) return;
    if (!trip || entry?.tripId !== tripId) {
      nav.back();
      return;
    }
    waterKey =
      trip.country === pack.country && pack.waters.some((w) => w.id === trip.waterId)
        ? pack.country + ':' + trip.waterId
        : null;
    options = await rpc('public_card_options', { catch_id: catchId, water_key: waterKey });
  } catch (error) {
    failed(view, nav, error);
    return;
  }
  if (!view.active()) return;
  screen.innerHTML = back(t('Výprava', 'Trip')) + '<h1>' + title() + '</h1>';
  bindBack(nav);
  if (options.active) {
    const host = document.createElement('section');
    host.className = 'surface';
    host.innerHTML =
      '<h2>' +
      esc(options.active.species) +
      '</h2><p>' +
      t('Tato karta má aktivní odkaz.', 'This card has an active link.') +
      '</p>';
    screen.append(host);
    linkControls(host, options.active, view, nav);
    return;
  }
  const species = pack.species[entry.speciesId]
    ? loc(pack.species[entry.speciesId])
    : entry.speciesName || entry.speciesId;
  const settings = document.createElement('section');
  settings.className = 'surface';
  settings.innerHTML =
    '<p>' +
    t(
      'Každý s odkazem uvidí tento náhled. Základem je přezdívka, druh ryby a měsíc úlovku.',
      'Anyone with the link can see this preview. It includes your display name, species and catch month.',
    ) +
    '</p>' +
    checkbox('public-day', t('Přidat přesný den', 'Include exact date')) +
    (options.water
      ? checkbox('public-water', t('Přidat revír', 'Include water') + ' · ' + options.water)
      : '') +
    (entry.hasPhoto ? checkbox('public-photo', t('Přidat fotografii', 'Include photo')) : '') +
    (options.proof
      ? checkbox('public-length', t('Přidat zkontrolovanou délku', 'Include reviewed length'))
      : '') +
    '<p class="meta">' +
    t(
      'Fotka může prozradit místo podle okolí. GPS a soukromé poznámky zůstávají v deníku.',
      'The surroundings in a photo may reveal your spot. GPS and private notes stay in your journal.',
    ) +
    '</p>';
  screen.append(settings);
  const output = document.createElement('div');
  output.innerHTML =
    '<h2>' +
    t('Náhled pro příjemce', 'Recipient preview') +
    '</h2><div id="public-preview"></div>' +
    '<p role="status" id="public-status"></p>' +
    button('public-publish', t('Vytvořit veřejný odkaz', 'Create public link'), 'primary');
  screen.append(output);
  let latest,
    photoTask,
    revision = 0;
  async function preview() {
    const update = ++revision;
    latest = null;
    by('public-publish').disabled = true;
    const precise = by('public-day').checked,
      proof = by('public-length')?.checked ? options.proof : null;
    const draft = {
      name: options.name,
      species: proof?.species || species,
      precision: precise ? 'day' : 'month',
      date: precise ? trip.day : trip.day.slice(0, 7),
    };
    const includeWater = by('public-water')?.checked;
    if (includeWater) draft.water = options.water;
    if (proof) draft.length = { kind: proof.kind, mm: proof.mm };
    const host = by('public-preview'),
      status = by('public-status');
    let photo = null;
    renderPublicCard(host, draft, cs ? 'cs' : 'en');
    status.textContent = '';
    if (by('public-photo')?.checked) {
      status.textContent = t('Připravuji fotku…', 'Preparing photo…');
      try {
        photoTask ??= Journal.photo(catchId).then((file) => photoPayload(file, 640, 49152, competitionPhoto));
        photo = await photoTask;
      } catch {
        photoTask = undefined;
        if (view.active() && update === revision)
          status.textContent = t(
            'Fotku nelze připravit. Zruš výběr nebo ji vyber znovu.',
            'Could not prepare the photo. Deselect it or select it again.',
          );
        return;
      }
      if (!view.active() || update !== revision) return;
      renderPublicCard(host, { ...draft, photo }, cs ? 'cs' : 'en');
      status.textContent = '';
    }
    latest = { draft, water_key: includeWater ? waterKey : null, photo };
    by('public-publish').disabled = false;
  }
  settings.onchange = preview;
  bind('public-publish', async () => {
    const copy = latest;
    if (
      !copy ||
      !(await confirmAction({
        title: t('Zveřejnit tuto kartu?', 'Publish this card?'),
        message: t(
          'Každý, kdo odkaz získá, ji může otevřít a předat dál.',
          'Anyone who receives the link can open it and pass it on.',
        ),
        accept: t('Zveřejnit', 'Publish'),
      })) ||
      !view.active() ||
      latest !== copy
    )
      return;
    view.route.requestId ??= newJournalId();
    await submitChange(
      view,
      () => rpc('public_card_publish', { catch_id: catchId, request_id: view.route.requestId, ...copy }),
      () => {
        delete view.route.requestId;
        nav.show();
      },
      (err) => {
        if (err.status === 409) {
          delete view.route.requestId;
          failed(view, nav, err);
        } else toast(message(err));
      },
    );
  });
  await preview();
}

/** Revocation remains available on another phone or after deletion of the original local trip. */
export async function myPublicCards({ view, nav }) {
  let page;
  try {
    page = await rpc('public_cards', { before_position: view.route.cursor || null });
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    mine() +
    '</h1>' +
    (page.items.length ? '' : '<p>' + t('Žádné další veřejné karty.', 'No more public cards.') + '</p>');
  bindBack(nav);
  for (const item of page.items) {
    const host = document.createElement('article');
    host.className = 'surface';
    host.innerHTML = '<h2>' + esc(item.species) + '</h2><p>' + esc(item.date) + '</p>';
    screen.append(host);
    linkControls(host, item, view, nav);
  }
  if (page.next) {
    screen.insertAdjacentHTML(
      'beforeend',
      button('older-public', t('Starší karty', 'Older cards'), 'secondary'),
    );
    bind('older-public', () => nav.open('myPublicCards', { cursor: page.next }));
  }
}
