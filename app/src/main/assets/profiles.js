import { insertMarkup, replaceMarkup } from './markup.js';
import { profileDetailsSummary } from './angler-details.js';
import {
  by,
  screen,
  t,
  esc,
  bind,
  button,
  icon,
  back,
  bindBack,
  field,
  textInput,
  trackEdits,
  toast,
} from './ui.js';
import { authorRating } from './tip-ratings.js';
import { rpc, failure, photoPayload } from './profile-api.js';

/** Prefer the uploaded image, then a known portrait index, then the generic fish icon. */
function portrait(avatar, photo) {
  if (photo) return '<img class="angler-portrait" alt="" src="data:image/jpeg;base64,' + esc(photo) + '">';
  if (!Number.isInteger(avatar) || avatar < 1 || avatar > 50)
    return '<span class="angler-portrait no-portrait" aria-hidden="true">' + icon('fish-symbol') + '</span>';
  const index = avatar - 1;
  return (
    '<span aria-hidden="true" class="angler-portrait portrait-x' +
    (index % 10) +
    ' portrait-y' +
    Math.floor(index / 10) +
    '"></span>'
  );
}

/** Offer retry, sign-in or account settings according to the profile request failure. */
export function showError(view, nav, error) {
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<p role="alert">' +
      failure(error) +
      '</p>' +
      button('retry-profile', t('common.retry'), 'secondary') +
      (error.status === 401 ? button('sign-in', t('common.sign_in'), 'primary') : '') +
      button('account-settings', t('common.account_settings'), 'secondary'),
  );
  bindBack(nav);
  bind('retry-profile', () => nav.show());
  bind('account-settings', () => window.Device.profile());
  if (by('sign-in')) bind('sign-in', () => window.Device.profileSignIn());
}

/** Load the owner's profile or another angler's visible card for the selected route.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function profileScreen({ view, nav }) {
  const id = view.route.id || null;
  const own = !id;
  if (own && window.Device?.groupSharingOnly?.()) {
    replaceMarkup(
      screen,
      back(t('common.back')) +
        '<p>' +
        esc(t('age.group_rule')) +
        '</p>' +
        button('account-settings', t('profiles.account_and_group_settings'), 'primary'),
    );
    bindBack(nav);
    bind('account-settings', () => window.Device.profile());
    return;
  }
  let card;
  try {
    card = await rpc('card', { profile_id: id });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  const groups = card.groups.map((name) => '<li>' + esc(name) + '</li>').join('');
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<article class="surface angler-card"><div class="angler-heading">' +
      portrait(card.avatar, card.photo) +
      '<div><h1>' +
      esc(card.name) +
      '</h1>' +
      (card.hometown ? '<p>' + esc(card.hometown) + '</p>' : '') +
      '</div></div>' +
      (card.tagline ? '<h2>' + esc(card.tagline) + '</h2>' : '') +
      (card.biography ? '<p class="biography">' + esc(card.biography) + '</p>' : '') +
      '<section class="profile-count"><h2>' +
      t('profiles.photo_documented_catches') +
      '</h2><strong>' +
      esc(card.verifiedCount) +
      '</strong></section>' +
      authorRating(card.authorRating, true) +
      '<section><h2>' +
      (own ? t('profiles.my_groups') : t('profiles.groups_in_common')) +
      '</h2>' +
      (groups
        ? '<ul>' + groups + '</ul>'
        : '<p>' +
          (own ? t('profiles.you.have.not.joined.a.group.yet') : t('profiles.no_groups_in_common')) +
          '</p>') +
      '</section>' +
      (own
        ? '<p class="meta">' +
          (card.shared ? t('profiles.published_to_signed_in_anglers') : t('profiles.private_profile')) +
          '</p>'
        : '') +
      '</article>' +
      (!own ? button('report-profile', t('moderation.report'), 'secondary') : '') +
      (own
        ? '<div class="actions">' +
          button('edit-card', t('profiles.edit_profile'), 'primary') +
          button('private-details', t('license.details'), 'secondary') +
          '<p id="private-summary" class="meta"></p>' +
          button('tip-market', t('market.title'), 'secondary') +
          button('my-public-cards', t('common.my_public_cards'), 'secondary') +
          button('my-activity', t('common.my_activity_contributions'), 'secondary') +
          button('weekly-groups', t('profiles.group_catch_of_the_week'), 'secondary') +
          button('private-inbox', t('common.private_messages'), 'secondary') +
          button('directory', t('profiles.angler_directory'), 'secondary') +
          button('evidence', t('common.my_submitted_catch_photos'), 'secondary') +
          button('account-settings', t('profiles.account_and_group_settings'), 'secondary') +
          '</div>'
        : ''),
  );
  bindBack(nav);
  if (!own)
    bind('report-profile', async () => {
      const report = /** @type {HTMLButtonElement} */ (by('report-profile'));
      report.disabled = true;
      try {
        await rpc('report_content', { kind: 'profile', target: id });
        report.textContent = t('common.reported');
      } catch (error) {
        report.disabled = false;
        if (view.active()) toast(failure(error));
      }
    });
  if (own) {
    profileDetailsSummary(view);
    bind('private-details', () => nav.open('anglerDetails'));
    bind('edit-card', () => nav.open('editProfile'));
    bind('tip-market', () => nav.open('marketShelf'));
    bind('my-public-cards', () => nav.open('myPublicCards'));
    bind('my-activity', () => nav.open('myActivity'));
    bind('weekly-groups', () => nav.open('weeklyGroups'));
    bind('private-inbox', () => nav.open('messageInbox'));
    bind('directory', () => nav.open('directory'));
    bind('evidence', () => nav.open('evidence'));
    bind('account-settings', () => window.Device.profile());
  }
}

/** Load the current profile and retain the editor while the user reviews and submits changes.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function editProfile({ view, nav }) {
  let card;
  try {
    card = await rpc('card', { profile_id: null });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  let { avatar, photo } = card;
  const choices = Array.from({ length: 50 }, (_, i) => {
    const n = i + 1;
    return (
      '<label class="portrait-choice"><input type="radio" name="portrait" value="' +
      n +
      '" aria-label="' +
      esc(t('profiles.portrait')) +
      n +
      '"' +
      (avatar === n ? ' checked' : '') +
      '>' +
      portrait(n, null) +
      '</label>'
    );
  }).join('');
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      t('profiles.edit_profile') +
      '</h1>' +
      '<form class="entry-form" id="card-form"><fieldset class="surface angler-editor"><legend>' +
      t('profiles.my_profile') +
      '</legend>' +
      '<div id="portrait-preview">' +
      portrait(avatar, photo) +
      '</div>' +
      '<details class="fold"><summary>' +
      t('profiles.choose_a_portrait_50') +
      '</summary><div class="portrait-grid">' +
      choices +
      '</div></details>' +
      field(
        'profile-photo',
        t('profiles.your_own_image_or_photograph'),
        '<input type="file" id="profile-photo" accept="image/*">',
      ) +
      button('clear-photo', t('profiles.remove_picture'), 'secondary') +
      textInput(
        'hometown',
        t('profiles.hometown'),
        card.hometown,
        'maxlength="80" autocomplete="address-level2"',
      ) +
      textInput('tagline', t('profiles.short_tagline'), card.tagline, 'maxlength="100"') +
      field(
        'biography',
        t('profiles.about_me'),
        '<textarea rows="4" id="biography" maxlength="600">' + esc(card.biography) + '</textarea>',
      ) +
      '<label class="publish-choice"><input type="checkbox" id="shared"' +
      (card.shared ? ' checked' : '') +
      '>' +
      t('profiles.publish_my_profile_to_all_signed_in') +
      '</label>' +
      '<small>' +
      t('profiles.saving_sends_the_profile_and_chosen_picture') +
      '</small>' +
      '</fieldset><p role="alert" id="card-error"></p><div class="actions"><button class="primary" id="save-card">' +
      t('common.save_profile') +
      '</button>' +
      button('reload-card', t('profiles.reload_saved_profile'), 'secondary') +
      '</div></form>',
  );
  bindBack(nav);
  trackEdits(by('card-form'), view);
  bind('reload-card', () => {
    nav.leave(() => nav.show());
  });
  const radios = Array.from(
    /** @type {NodeListOf<HTMLInputElement>} */ (screen.querySelectorAll('[name="portrait"]')),
  );
  /** Refresh the draft profile image without publishing the profile. */
  function preview() {
    replaceMarkup(by('portrait-preview'), portrait(avatar, photo));
  }
  for (const radio of radios)
    radio.onchange = () => {
      avatar = Number(radio.value);
      photo = null;
      by('profile-photo').value = '';
      preview();
    };
  bind('clear-photo', () => {
    avatar = 0;
    photo = null;
    radios.forEach((r) => (r.checked = false));
    by('profile-photo').value = '';
    view.dirty = true;
    preview();
  });
  const form = by('card-form'),
    fields = form.querySelector('fieldset'),
    save = by('save-card');
  /** Prevent simultaneous edits while a profile submission is pending. */
  function lock(locked) {
    fields.disabled = save.disabled = by('reload-card').disabled = view.saving = locked;
  }
  by('profile-photo').onchange = async () => {
    const file = by('profile-photo').files[0];
    if (!file) return;
    lock(true);
    try {
      photo = await photoPayload(file, 288, 65536);
      avatar = 0;
      radios.forEach((r) => (r.checked = false));
      preview();
    } catch {
      toast(t('profiles.cannot_read_this_image_choose_another_file'));
    } finally {
      lock(false);
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving) return;
    lock(true);
    try {
      await rpc('save_card', {
        expected: card.revision,
        hometown: by('hometown').value,
        tagline: by('tagline').value,
        biography: by('biography').value,
        avatar,
        photo,
        shared: by('shared').checked,
      });
      view.dirty = false;
    } catch (error) {
      by('card-error').textContent = failure(error);
      if (error.status === 401 && !by('editor-sign-in')) {
        insertMarkup(
          by('card-error'),
          'beforeend',
          button('editor-sign-in', t('common.sign_in'), 'secondary'),
        );
        bind('editor-sign-in', () => {
          nav.leave(() => window.Device.profileSignIn());
        });
      }
      return;
    } finally {
      lock(false);
    }
    nav.back();
  };
}

/** List the directory page selected by the current search and pagination state.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function directoryScreen({ view, nav }) {
  let page;
  try {
    page = await rpc('directory', { after_id: view.route.cursor || null });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      t('profiles.angler_directory') +
      '</h1><div class="profile-directory">' +
      (page.profiles
        .map(
          (p) =>
            '<button class="surface directory-entry" data-card="' +
            esc(p.id) +
            '">' +
            portrait(p.avatar, null) +
            esc(p.name) +
            '</button>',
        )
        .join('') || '<p>' + t('profiles.there_are_no_published_profiles_here_yet') + '</p>') +
      '</div>' +
      (page.more ? button('more-cards', t('profiles.more_profiles'), 'secondary') : ''),
  );
  bindBack(nav);
  /** @type {NodeListOf<HTMLButtonElement>} */ (screen.querySelectorAll('[data-card]')).forEach(
    (b) => (b.onclick = () => nav.open('anglerProfile', { id: b.dataset.card })),
  );
  if (page.more)
    bind('more-cards', () => nav.open('directory', { cursor: page.profiles[page.profiles.length - 1].id }));
}
