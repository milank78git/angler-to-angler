import { newJournalId, Journal } from './journal.js';
import { competitionPhoto } from './photo.js';
import { rpc, photoPayload, failure } from './profile-api.js';
import {
  back,
  bindBack,
  bind,
  button,
  by,
  displayDay,
  esc,
  field,
  screen,
  t,
  toast,
  confirmAction,
} from './ui.js';
import { replaceMarkup } from './markup.js';

/** Preview the exact payload addressed to one closed group. The journal location and notes stay local. */
export async function groupCatch(view, nav, trip, entry, species) {
  const result = await rpc('groups');
  if (!view.active()) return;
  // A group-only account needs an affirmative grant even if an older response omits permissions.
  const groupOnly = result.ageBand === 'child' || window.Device?.groupSharingOnly?.();
  const groups = result.groups.filter((group) =>
    groupOnly ? group.canShareCatch === true : group.canShareCatch !== false,
  );
  const form = field('catch-group', t('common.recipient'), '<select id="catch-group"></select>');
  replaceMarkup(
    screen,
    back(t('common.trip')) +
      '<h1>' +
      t('common.share_catch') +
      '</h1><section class="surface"><p>' +
      [esc(species), displayDay(trip.day), entry.lengthMm ? esc(entry.lengthMm) + ' mm' : '']
        .filter(Boolean)
        .join(' · ') +
      '</p>' +
      (groups.length
        ? form +
          (entry.hasPhoto
            ? '<label><input type="checkbox" id="include-photo">' + t('share_card.photo') + '</label>'
            : '') +
          button('send-group-catch', t('common.share_catch'), 'primary')
        : '<p>' + t('age.no_permission') + '</p>') +
      '</section>',
  );
  bindBack(nav);
  if (!groups.length) return;
  const select = by('catch-group');
  select.add(new Option(t('group_tip.select_a_group'), ''));
  for (const group of groups) select.add(new Option(group.name, group.id));
  const send = by('send-group-catch');
  send.disabled = true;
  let attempt;
  select.onchange = () => {
    send.disabled = !select.value;
  };
  bind('send-group-catch', async () => {
    if (send.disabled || !select.value) return;
    send.disabled = true;
    const group = select.value,
      groupName = select.selectedOptions[0].text;
    try {
      const checked = by('include-photo')?.checked;
      const photo = checked
        ? await photoPayload(await Journal.photo(entry.id), 640, 49152, competitionPhoto)
        : null;
      if (!view.active()) return;
      const approved = await confirmAction({
        title: t('common.share_catch'),
        message: t('age.group_preview').replace('{group}', groupName),
        accept: t('common.share_catch'),
        catchPreview: {
          species,
          water: displayDay(trip.day) + ' · ' + groupName,
          url: photo ? 'data:image/webp;base64,' + photo : '',
        },
      });
      if (!approved || !view.active()) return;
      if (!attempt || attempt.group_id !== group || attempt.photo !== photo)
        attempt = {
          group_id: group,
          request_id: newJournalId(),
          day: trip.day,
          species,
          length_mm: entry.lengthMm || null,
          photo,
        };
      const receipt = await rpc('group_catch_post', attempt);
      if (receipt.id?.replaceAll('-', '') !== attempt.request_id.replaceAll('-', ''))
        throw Error('Invalid receipt');
      if (view.active()) {
        toast(t('age.shared'));
        nav.back();
      }
    } catch (error) {
      if (view.active()) toast(failure(error));
    } finally {
      if (view.active()) send.disabled = !select.value;
    }
  });
}
