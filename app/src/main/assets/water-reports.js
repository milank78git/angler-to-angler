import { rpc } from './profile-api.js';
import { t, confirmAction } from './ui.js';

/** Each count is the number of distinct accounts reporting this condition in the last 24 hours. */
export async function waterReports(host, water, view) {
  const intro = document.createElement('p');
  intro.textContent = t('water_reports.angler_observations_in_the_last_24_hours');
  const feedback = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = t('common.refresh');
  refresh.hidden = true;
  feedback.append(status, refresh);
  host.replaceChildren(intro, feedback);

  const rows = new Map();
  const labels = {
    low_water: t('water_reports.low_water'),
    fish_deaths: t('water_reports.fish_deaths'),
    closure: t('water_reports.reported_closure'),
  };
  for (const kind of Object.keys(labels)) {
    const row = document.createElement('div');
    row.className = 'water-report-row';
    row.hidden = true;
    const summary = document.createElement('span');
    summary.id = 'report-' + kind;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-describedby', summary.id);
    button.onclick = () => changeReport(kind);
    row.append(summary, button);
    host.append(row);
    rows.set(kind, { row, summary, button, mine: false });
  }

  /** Keep report actions from racing the current submission. */
  function setActionsDisabled(disabled) {
    for (const { button } of rows.values()) button.disabled = disabled;
  }

  // Refresh only reads. A lost acknowledgement must never cause a second write.
  async function loadReports(receipt = '', uncertainKind) {
    const restoreFocus = document.activeElement === refresh;
    refresh.disabled = true;
    status.textContent = receipt || t('water_reports.loading');
    try {
      const alerts = await rpc('water_alerts', { water_key: water });
      if (!view.active()) return;
      for (const [kind, item] of rows) {
        const { count = 0, mine = false } = alerts[kind] || {};
        item.mine = mine;
        item.row.hidden = false;
        item.row.classList.toggle('water-alert', count >= 3);
        const level =
          count >= 3
            ? t('water_reports.multiple_reports')
            : count
              ? t('water_reports.unconfirmed')
              : t('water_reports.no_reports');
        item.summary.textContent = labels[kind] + ' · ' + level + ' (' + count + ')';
        item.button.textContent = mine
          ? t('water_reports.withdraw_report')
          : t('water_reports.report_my_observation');
      }
      status.textContent = uncertainKind
        ? rows.get(uncertainKind).mine
          ? t('water_reports.own_report_active')
          : t('water_reports.no_own_report')
        : receipt;
      refresh.hidden = true;
      setActionsDisabled(false);
      if (restoreFocus && (document.activeElement === document.body || document.activeElement === refresh)) {
        const row = feedback.closest('.water-report-row') || host.querySelector('.water-report-row');
        row.querySelector(':scope > button').focus({ preventScroll: true });
      }
    } catch (error) {
      if (!view.active()) return;
      status.textContent = [
        receipt,
        t(error.status === 429 ? 'limits.hourly' : 'water_reports.reports_could_not_be_loaded'),
      ]
        .filter(Boolean)
        .join(' ');
      offerRefresh(() => loadReports(receipt, uncertainKind));
    }
  }

  /** Offer to reload the current report after a stale response. */
  function offerRefresh(read) {
    refresh.onclick = read;
    refresh.hidden = false;
    refresh.disabled = false;
  }

  /** Apply the report action and refresh the visible state on success. */
  async function changeReport(kind) {
    const { row, button, summary, mine } = rows.get(kind);
    if (button.disabled || !view.active()) return;
    const accepted = await confirmAction({
      title: labels[kind],
      message: mine ? t('water_reports.confirm_withdraw') : t('water_reports.confirm_send'),
      accept: mine ? t('water_reports.withdraw_report') : t('water_reports.send_report'),
    });
    if (!accepted || !view.active() || button.disabled) return;
    setActionsDisabled(true);
    row.insertBefore(feedback, button);
    status.textContent = mine ? t('water_reports.withdrawing') : t('water_reports.sending');
    try {
      await rpc('water_report', { water_key: water, kind, withdraw: mine });
    } catch (error) {
      if (!view.active()) return;
      if (error.status === 429) {
        status.textContent = t('limits.hourly');
        setActionsDisabled(false);
      } else if (error.status === 401 || error.status === 403 || error.status === 422) {
        status.textContent =
          error.status === 401
            ? t('profile_api.sign_in_again_to_use_the_online')
            : error.status === 403
              ? t('profile_api.you_do_not_have_access_to_this')
              : t('water_reports.not_accepted');
        setActionsDisabled(false);
      } else {
        summary.textContent = labels[kind];
        row.classList.remove('water-alert');
        status.textContent = t('water_reports.check_the_report_after_refreshing');
        offerRefresh(() => loadReports('', kind));
      }
      return;
    }
    if (!view.active()) return;
    summary.textContent = labels[kind];
    row.classList.remove('water-alert');
    button.textContent = mine ? t('water_reports.report_my_observation') : t('water_reports.withdraw_report');
    await loadReports(mine ? t('water_reports.withdrawn') : t('water_reports.recorded'));
  }

  await loadReports();
}
