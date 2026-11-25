import { replaceMarkup } from './markup.js';
import {
  by,
  screen,
  t,
  esc,
  back,
  bindBack,
  button,
  bind,
  displayDay,
  field,
  selectField,
  submitChange,
  trackEdits,
  toast,
} from './ui.js';
import { rpc, failure } from './profile-api.js';

const read = () => rpc('my_details');
let refreshing;

/** Refresh the device's offline alarm from the verified account, without blocking the atlas. */
export function bindLicenseNotice(nav) {
  const banner = by('license-notice');
  const display = () => {
    const message = window.Device?.licenseMessage?.() || '';
    banner.textContent = message;
    banner.hidden = !message;
    const permission = by('license-permission');
    if (permission)
      permission.hidden =
        !by('permit-expiry')?.value ||
        by('permit-lead')?.value === 'off' ||
        window.Device?.licenseNotificationsEnabled?.() !== false;
  };
  banner.onclick = () => {
    if (nav.current?.route.page !== 'anglerDetails') nav.open('anglerDetails');
  };
  window.refreshLicense = () => {
    display();
    if (!refreshing)
      refreshing = read()
        .then(display)
        .catch(() => {})
        .finally(() => {
          refreshing = null;
        });
  };
  window.addEventListener('online', window.refreshLicense);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) window.refreshLicense();
  });
  // Keep the warning accurate when the app is open across a date change, including offline.
  setInterval(() => {
    if (!document.hidden) display();
  }, 60000);
  window.refreshLicense();
}

/** Render only on the account owner's own card, independently of its publication status. */
export async function profileDetailsSummary(view) {
  try {
    const data = await read();
    if (!view.active()) return;
    const lines = [];
    if (data.age != null) lines.push(t('license.age') + ' · ' + data.age);
    if (data.expiry) lines.push(t('license.expiry') + ' · ' + displayDay(data.expiry));
    by('private-summary').textContent = lines.join(' / ');
  } catch {
    /* The public profile remains available if the private request is offline. */
  }
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function anglerDetails({ view, nav }) {
  let data;
  try {
    data = await read();
  } catch (error) {
    if (!view.active()) return;
    replaceMarkup(
      screen,
      back(t('common.back')) +
        '<h1>' +
        t('license.details') +
        '</h1><p role="alert">' +
        esc(failure(error)) +
        '</p>' +
        button('retry-details', t('common.retry'), 'secondary'),
    );
    bindBack(nav);
    bind('retry-details', () => nav.show());
    return;
  }
  if (!view.active()) return;
  const leads = [
    ['off', t('license.off')],
    ['week', t('license.week')],
    ['month', t('license.month')],
  ];
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      t('license.details') +
      '</h1>' +
      '<form id="details-form" class="entry-form"><section class="surface"><p>' +
      t('license.private') +
      '</p>' +
      field(
        'angler-age',
        t('license.age'),
        '<input id="angler-age" type="number" inputmode="numeric" min="0" max="125" step="1" value="' +
          esc(data.age ?? '') +
          '">',
      ) +
      field(
        'permit-expiry',
        t('license.expiry'),
        '<input id="permit-expiry" type="date" min="1900-01-01" max="9999-12-31" value="' +
          esc(data.expiry || '') +
          '">',
      ) +
      selectField('permit-lead', t('license.reminder'), leads, data.reminder) +
      '<div id="license-permission" hidden><p>' +
      t('license.permission_info') +
      '</p>' +
      button('allow-license', t('license.allow'), 'secondary') +
      '</div></section>' +
      '<p id="details-error" role="alert"></p><div class="actions"><button class="primary" type="submit">' +
      t('common.save_profile') +
      '</button>' +
      button('reload-details', t('profiles.reload_saved_profile'), 'secondary') +
      '</div></form>',
  );
  bindBack(nav);
  const form = by('details-form'),
    expiry = by('permit-expiry'),
    lead = by('permit-lead');
  trackEdits(form, view);
  function update() {
    lead.disabled = !expiry.value;
    if (!expiry.value) lead.value = 'off';
    by('license-permission').hidden =
      !expiry.value || lead.value === 'off' || window.Device?.licenseNotificationsEnabled?.() !== false;
  }
  expiry.oninput = lead.onchange = update;
  update();
  bind('allow-license', () => window.Device?.enableLicenseNotifications?.());
  bind('reload-details', () => nav.leave(() => nav.show()));
  form.onsubmit = (event) => {
    event.preventDefault();
    const age = by('angler-age').value;
    const changes = {
      age: age === '' ? null : Number(age),
      expiry: expiry.value || null,
      reminder: lead.value,
      revision: data.revision,
    };
    submitChange(
      view,
      () => rpc('my_details', { changes }),
      () => {
        view.dirty = false;
        window.refreshLicense?.();
        nav.back();
        toast(t('license.saved'));
        if (
          changes.reminder !== 'off' &&
          changes.reminder !== data.reminder &&
          window.Device?.licenseNotificationsEnabled?.() === false
        )
          window.Device.enableLicenseNotifications();
      },
      (error) => {
        by('details-error').textContent = error.status === 409 ? t('license.conflict') : failure(error);
        update();
      },
    );
  };
}
