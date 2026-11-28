import { replaceMarkup } from './markup.js';
import { languageTag } from './i18n.js';
import { groupCatch } from './group-catch.js';
import { bindGroupTip, groupTipControls } from './group-tip.js';
import { Journal } from './journal.js';
import { pixelJpeg } from './photo.js';
import { back, bindBack, button, by, displayDay, esc, field, loc, screen, t, toast } from './ui.js';

/** A card is an allowlist of display values. Private journal records never cross the Android bridge. */
function cardFields(trip, entry) {
  const length = entry?.lengthMm
    ? new Intl.NumberFormat(languageTag).format(entry.lengthMm / 10) + ' cm'
    : '';
  return [
    ['length', t('share_card.length'), length],
    ['day', t('common.trip_date'), trip.day && displayDay(trip.day)],
    ['water', t('common.water'), trip.waterName],
    ['bait', t('common.bait'), entry?.bait],
    ['technique', t('common.technique'), entry?.technique],
  ].filter(([, , value]) => value);
}

/** Build the shareable photo representation without sending the journal's original metadata. */
async function photoCopy(id) {
  const stored = await Journal.photo(id);
  if (!stored) throw Error('Photo unavailable');
  const jpeg = await pixelJpeg(stored, 1280);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(jpeg);
  });
}

/** Build a private preview and export precisely the fields the owner selected.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function shareCard({ view, nav, pack }) {
  const { tripId, catchId } = view.route;
  const [trip, entry] = await Promise.all([
    Journal.trip(tripId),
    catchId ? Journal.catchById(catchId) : null,
  ]);
  if (!view.active()) return;
  if (!trip || (catchId && (!entry || entry.tripId !== tripId))) {
    nav.back();
    return;
  }
  const species = pack.species[entry?.speciesId];
  const speciesName = species ? loc(species) : entry?.speciesName || entry?.speciesId;
  if (entry && window.Device?.groupSharingOnly?.()) return groupCatch(view, nav, trip, entry, speciesName);
  const heading = entry ? t('common.share_catch') : t('common.share_a_trip_tip');
  const tipField = field(
    'share-tip-text',
    entry ? t('share_card.tip_for_others_optional') : t('share_card.what_would_you_tell_other_anglers'),
    '<textarea id="share-tip-text" rows="3" maxlength="1600"></textarea>',
  );
  const restricted = window.Device?.groupSharingOnly?.();
  const fields = restricted ? [] : cardFields(trip, entry);
  const choices = fields.map(([key, label]) => [key, label]);
  if (entry?.hasPhoto && !restricted) choices.push(['photo', t('share_card.photo')]);
  replaceMarkup(
    screen,
    back(t('common.trip')) +
      `
    <div class="page-intro"><h1>${heading}</h1></div>
    <div class="columns"><section class="surface"><h2>${t('share_card.what_would_you_like_to_share')}</h2>
        ${tipField}
        <p>${entry ? t('share_card.your_card_includes_the_species_choose_any') : t('share_card.you_can_add_the_date_and_water')}</p>
        <div id="card-options">${choices
          .map(
            ([key, label]) =>
              `<label class="card-option"><input type="checkbox" id="share-${key}">${esc(label)}</label>`,
          )
          .join('')}</div>
        <p class="meta">
          ${entry ? t('share_card.coordinates_and_journal_notes_stay_private_the') : t('share_card.private_journal_notes_are_never_copied_into')}
          </p></section><section class="surface"><h2>${t('common.recipient_preview')}</h2>
        <p id="card-text" aria-live="polite"></p><img id="card-image" class="preview" hidden alt="${esc(t('share_card.catch_photo_for_sharing'))}">
        <p id="card-status" role="status" hidden></p>
        <div class="actions">${button('card-send', entry ? t('share_card.choose_recipient') : t('share_card.share_via_another_app'), 'primary')}</div>
        ${entry ? button('catch-to-group', t('age.catches'), 'secondary') : groupTipControls()}</section>
    </div>`,
  );
  bindBack(nav);
  if (entry)
    by('catch-to-group').onclick = () =>
      groupCatch(view, nav, trip, entry, speciesName).catch(() => toast(t('age.no_permission')));
  const send = by('card-send'),
    image = by('card-image'),
    status = by('card-status');
  send.hidden = Boolean(restricted);
  let photoTask,
    payload,
    revision = 0;

  const syncGroup = entry ? null : bindGroupTip(view, nav, tripId, () => payload?.text);

  /** Keep the last ready preview and the outgoing payload identical, including during rapid changes. */
  async function preview() {
    const current = ++revision;
    payload = null;
    syncGroup?.();
    send.disabled = true;
    const tip = by('share-tip-text').value.trim();
    const lines = [
      speciesName,
      tip,
      ...fields
        .filter(([key]) => /** @type {HTMLInputElement} */ (by('share-' + key)).checked)
        .map(([, label, value]) => label + ' · ' + value),
    ];
    const text = lines.filter(Boolean).join('\n');
    by('card-text').textContent = text;
    status.hidden = true;
    const includePhoto = by('share-photo')?.checked;
    if (!includePhoto) {
      image.hidden = true;
      image.removeAttribute('src');
    }
    if (!entry && !tip) return;
    if (text.length > 4096) {
      status.hidden = false;
      status.textContent = t('share_card.shorten_the_text_or_remove_a_detail');
      return;
    }
    let jpeg = '';
    if (includePhoto) {
      status.hidden = false;
      status.textContent = t('share_card.preparing_photo');
      try {
        photoTask ??= photoCopy(catchId);
        const dataUrl = await photoTask;
        if (!view.active() || current !== revision) return;
        if (image.src !== dataUrl) image.src = dataUrl;
        image.hidden = false;
        jpeg = dataUrl.slice(dataUrl.indexOf(',') + 1);
        status.hidden = true;
      } catch {
        if (!view.active() || current !== revision) return;
        photoTask = undefined;
        status.textContent = t('share_card.could_not_prepare_the_photo_deselect_it');
        return;
      }
    }
    payload = { text, jpeg };
    send.disabled = false;
    syncGroup?.();
  }
  by('card-options').onchange = preview;
  by('share-tip-text').oninput = () => {
    view.dirty = Boolean(by('share-tip-text').value.trim());
    preview();
  };
  send.onclick = () => {
    if (!payload || !view.active()) return;
    // Export the same completed snapshot displayed in the preview, even after several edits.
    if (window.Device?.shareCatch?.(payload.text, payload.jpeg)) {
      view.dirty = false;
    } else toast(t('share_card.could_not_open_sharing_please_retry'));
  };
  await preview();
}
