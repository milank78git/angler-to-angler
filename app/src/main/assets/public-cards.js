import { insertMarkup, replaceMarkup } from './markup.js';
import { tripWater } from './water-directory.js';
import { languageTag } from './i18n.js';
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
  esc,
  link,
  loc,
  screen,
  submitChange,
  t,
  toast,
} from './ui.js';

const title = () => t('common.public_catch_card');
const mine = () => t('common.my_public_cards');
const checkbox = (id, label) =>
  '<label class="card-option"><input type="checkbox" id="' + id + '">' + esc(label) + '</label>';

function message(error) {
  if (error.status === 429) return t('limits.hourly');
  if (error.status === 409) return t('public_cards.the_details_or_link_changed_refresh_the');
  if (error.status === 401 || error.status === 403) return t('public_cards.sign_in_again_to_manage_cards');
  if (error.status === 422 || error.status === 400)
    return t('public_cards.check_the_date_species_and_selected_photo');
  return t('common.service_unavailable_check_your_connection_and_retry');
}

function failed(view, nav, error) {
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      title() +
      '</h1><p role="alert">' +
      message(error) +
      '</p>' +
      button('refresh-public', t('common.refresh'), 'secondary'),
  );
  bindBack(nav);
  bind('refresh-public', () => nav.show());
}

function linkControls(host, item, view, nav) {
  const url = new URL(item.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash !== '#' + item.id)
    throw Error('Invalid public link');
  const group = document.createElement('div');
  group.className = 'actions';
  replaceMarkup(group, link(url.href, t('public_cards.open_public_card')));
  const add = (label, cls, action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    btn.onclick = action;
    group.append(btn);
  };
  add(t('public_cards.share_link'), 'secondary', () => {
    if (!window.Device.shareCatch(url.href, '')) toast(t('public_cards.could_not_open_sharing'));
  });
  const remove = t('public_cards.revoke_link');
  add(remove, 'danger', async () => {
    if (
      !(await confirmAction({
        title: remove + '?',
        message: t('public_cards.this_address_will_stop_showing_the_catch'),
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
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function publicCardEditor({ view, nav, pack, waterDirectory }) {
  const { tripId, catchId } = view.route;
  let trip, entry, options, waterKey;
  try {
    [trip, entry] = await Promise.all([Journal.trip(tripId), Journal.catchById(catchId)]);
    if (!view.active()) return;
    if (!trip || entry?.tripId !== tripId) {
      nav.back();
      return;
    }
    waterKey = tripWater(waterDirectory, trip)?.key ?? null;
    options = await rpc('public_card_options', { catch_id: catchId, water_key: waterKey });
  } catch (error) {
    failed(view, nav, error);
    return;
  }
  if (!view.active()) return;
  replaceMarkup(screen, back(t('common.trip')) + '<h1>' + title() + '</h1>');
  bindBack(nav);
  if (options.active) {
    const host = document.createElement('section');
    host.className = 'surface';
    replaceMarkup(
      host,
      '<h2>' +
        esc(options.active.species) +
        '</h2><p>' +
        t('public_cards.this_card_has_an_active_link') +
        '</p>',
    );
    screen.append(host);
    linkControls(host, options.active, view, nav);
    return;
  }
  const species = pack.species[entry.speciesId]
    ? loc(pack.species[entry.speciesId])
    : entry.speciesName || entry.speciesId;
  const settings = document.createElement('section');
  settings.className = 'surface';
  replaceMarkup(
    settings,
    '<p>' +
      t('public_cards.anyone_with_the_link_can_see_this') +
      '</p>' +
      checkbox('public-day', t('public_cards.include_exact_date')) +
      (options.water
        ? checkbox('public-water', t('public_cards.include_water') + ' · ' + options.water)
        : '') +
      (entry.hasPhoto ? checkbox('public-photo', t('public_cards.include_photo')) : '') +
      (options.proof ? checkbox('public-length', t('public_cards.include_reviewed_length')) : '') +
      '<p class="meta">' +
      t('public_cards.the_surroundings_in_a_photo_may_reveal') +
      '</p>',
  );
  screen.append(settings);
  const output = document.createElement('div');
  replaceMarkup(
    output,
    '<h2>' +
      t('common.recipient_preview') +
      '</h2><div id="public-preview"></div>' +
      '<p role="status" id="public-status"></p>' +
      button('public-publish', t('public_cards.create_public_link'), 'primary'),
  );
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
    renderPublicCard(host, draft, languageTag, t);
    status.textContent = '';
    if (by('public-photo')?.checked) {
      status.textContent = t('public-cards.preparing.photo');
      try {
        photoTask ??= Journal.photo(catchId).then((file) => photoPayload(file, 640, 49152, competitionPhoto));
        photo = await photoTask;
      } catch {
        photoTask = undefined;
        if (view.active() && update === revision)
          status.textContent = t('public_cards.could_not_prepare_the_photo_deselect_it');
        return;
      }
      if (!view.active() || update !== revision) return;
      renderPublicCard(host, { ...draft, photo }, languageTag, t);
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
        title: t('public_cards.publish_this_card'),
        message: t('public_cards.anyone_who_receives_the_link_can_open'),
        accept: t('public_cards.publish'),
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
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function myPublicCards({ view, nav }) {
  let page;
  try {
    page = await rpc('public_cards', { before_position: view.route.cursor || null });
  } catch (err) {
    failed(view, nav, err);
    return;
  }
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      mine() +
      '</h1>' +
      (page.items.length ? '' : '<p>' + t('public_cards.no_more_public_cards') + '</p>'),
  );
  bindBack(nav);
  for (const item of page.items) {
    const host = document.createElement('article');
    host.className = 'surface';
    replaceMarkup(host, '<h2>' + esc(item.species) + '</h2><p>' + esc(item.date) + '</p>');
    screen.append(host);
    linkControls(host, item, view, nav);
  }
  if (page.next) {
    insertMarkup(screen, 'beforeend', button('older-public', t('public_cards.older_cards'), 'secondary'));
    bind('older-public', () => nav.open('myPublicCards', { cursor: page.next }));
  }
}
