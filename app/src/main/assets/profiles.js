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
import { rpc, failure, photoPayload } from './profile-api.js';

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

export function showError(view, nav, error) {
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<p role="alert">' +
    failure(error) +
    '</p>' +
    button('retry-profile', t('Zkusit znovu', 'Retry'), 'secondary') +
    (error.status === 401 ? button('sign-in', t('Přihlásit se', 'Sign in'), 'primary') : '') +
    button('account-settings', t('Nastavení účtu', 'Account settings'), 'secondary');
  bindBack(nav);
  bind('retry-profile', () => nav.show());
  bind('account-settings', () => window.Device.profile());
  if (by('sign-in')) bind('sign-in', () => window.Device.profileSignIn());
}

export async function profileScreen({ view, nav }) {
  const id = view.route.id || null;
  const own = !id;
  let card;
  try {
    card = await rpc('card', { profile_id: id });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  const groups = card.groups.map((name) => '<li>' + esc(name) + '</li>').join('');
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
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
    t('Úlovky doložené fotkou', 'Photo-documented catches') +
    '</h2><strong>' +
    esc(card.verifiedCount) +
    '</strong></section>' +
    '<section><h2>' +
    (own ? t('Moje party', 'My groups') : t('Společné party', 'Groups in common')) +
    '</h2>' +
    (groups
      ? '<ul>' + groups + '</ul>'
      : '<p>' +
        (own
          ? t('Zatím nejsi v žádné partě.', 'You have not joined a group yet.')
          : t('Žádná společná parta.', 'No groups in common.')) +
        '</p>') +
    '</section>' +
    (own
      ? '<p class="meta">' +
        (card.shared
          ? t('Zveřejněno pro přihlášené rybáře', 'Published to signed-in anglers')
          : t('Soukromý profil', 'Private profile')) +
        '</p>'
      : '') +
    '</article>' +
    (own
      ? '<div class="actions">' +
        button('edit-card', t('Upravit profil', 'Edit profile'), 'primary') +
        button('my-activity', t('Moje výpravy ve statistice', 'My activity contributions'), 'secondary') +
        button('weekly-groups', t('Úlovek týdne v partě', 'Group catch of the week'), 'secondary') +
        button('private-inbox', t('Soukromé zprávy', 'Private messages'), 'secondary') +
        button('directory', t('Profily rybářů', 'Angler directory'), 'secondary') +
        button('evidence', t('Moje odeslané fotky', 'My submitted catch photos'), 'secondary') +
        button('account-settings', t('Účet a správa part', 'Account and group settings'), 'secondary') +
        '</div>'
      : '');
  bindBack(nav);
  if (own) {
    bind('edit-card', () => nav.open('editProfile'));
    bind('my-activity', () => nav.open('myActivity'));
    bind('weekly-groups', () => nav.open('weeklyGroups'));
    bind('private-inbox', () => nav.open('messageInbox'));
    bind('directory', () => nav.open('directory'));
    bind('evidence', () => nav.open('evidence'));
    bind('account-settings', () => window.Device.profile());
  }
}

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
      t('Karikatura ', 'Portrait ') +
      n +
      '"' +
      (avatar === n ? ' checked' : '') +
      '>' +
      portrait(n, null) +
      '</label>'
    );
  }).join('');
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    t('Upravit profil', 'Edit profile') +
    '</h1>' +
    '<form class="entry-form" id="card-form"><fieldset class="surface angler-editor"><legend>' +
    t('Můj profil', 'My profile') +
    '</legend>' +
    '<div id="portrait-preview">' +
    portrait(avatar, photo) +
    '</div>' +
    '<details class="fold"><summary>' +
    t('Vybrat karikaturu (50)', 'Choose a portrait (50)') +
    '</summary><div class="portrait-grid">' +
    choices +
    '</div></details>' +
    field(
      'profile-photo',
      t('Vlastní obrázek nebo fotografie', 'Your own image or photograph'),
      '<input type="file" id="profile-photo" accept="image/*">',
    ) +
    button('clear-photo', t('Bez obrázku', 'Remove picture'), 'secondary') +
    textInput(
      'hometown',
      t('Odkud jsem', 'Hometown'),
      card.hometown,
      'maxlength="80" autocomplete="address-level2"',
    ) +
    textInput('tagline', t('Krátký popisek', 'Short tagline'), card.tagline, 'maxlength="100"') +
    field(
      'biography',
      t('Něco o mně', 'About me'),
      '<textarea rows="4" id="biography" maxlength="600">' + esc(card.biography) + '</textarea>',
    ) +
    '<label class="publish-choice"><input type="checkbox" id="shared"' +
    (card.shared ? ' checked' : '') +
    '>' +
    t('Zveřejnit profil všem přihlášeným rybářům', 'Publish my profile to all signed-in anglers') +
    '</label>' +
    '<small>' +
    t(
      'Uložením se profil a vybraný obrázek přenesou do pilotu. Zveřejnění můžeš kdykoliv vypnout. Názvy part uvidí jen společní členové.',
      'Saving sends the profile and chosen picture to the pilot. You can stop publishing at any time. Group names are visible only to fellow members.',
    ) +
    '</small>' +
    '</fieldset><p role="alert" id="card-error"></p><div class="actions"><button class="primary" id="save-card">' +
    t('Uložit profil', 'Save profile') +
    '</button>' +
    button('reload-card', t('Načíst uložený profil', 'Reload saved profile'), 'secondary') +
    '</div></form>';
  bindBack(nav);
  trackEdits(by('card-form'), view);
  bind('reload-card', () => {
    if (nav.mayLeave()) nav.show();
  });
  const radios = Array.from(screen.querySelectorAll('[name="portrait"]'));
  function preview() {
    by('portrait-preview').innerHTML = portrait(avatar, photo);
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
  function lock(locked) {
    fields.disabled = save.disabled = by('reload-card').disabled = view.saving = locked;
  }
  by('profile-photo').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    lock(true);
    try {
      photo = await photoPayload(file, 288, 65536);
      avatar = 0;
      radios.forEach((r) => (r.checked = false));
      preview();
    } catch {
      toast(
        t(
          'Obrázek nelze přečíst. Vyber jiný snímek do 30 MB.',
          'Cannot read this image. Choose another file under 30 MB.',
        ),
      );
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
        by('card-error').insertAdjacentHTML(
          'beforeend',
          button('editor-sign-in', t('Přihlásit se', 'Sign in'), 'secondary'),
        );
        bind('editor-sign-in', () => {
          if (nav.mayLeave()) window.Device.profileSignIn();
        });
      }
      return;
    } finally {
      lock(false);
    }
    nav.back();
  };
}

export async function directoryScreen({ view, nav }) {
  let page;
  try {
    page = await rpc('directory', { after_id: view.route.cursor || null });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    t('Profily rybářů', 'Angler directory') +
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
      .join('') ||
      '<p>' +
        t('Zatím zde není žádný zveřejněný profil.', 'There are no published profiles here yet.') +
        '</p>') +
    '</div>' +
    (page.more ? button('more-cards', t('Další profily', 'More profiles'), 'secondary') : '');
  bindBack(nav);
  screen
    .querySelectorAll('[data-card]')
    .forEach((b) => (b.onclick = () => nav.open('anglerProfile', { id: b.dataset.card })));
  if (page.more)
    bind('more-cards', () => nav.open('directory', { cursor: page.profiles[page.profiles.length - 1].id }));
}
