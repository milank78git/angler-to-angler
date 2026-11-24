import { rpc } from './profile-api.js';
import { t, confirmAction } from './ui.js';

/** Counts come from distinct verified accounts in the last 24 hours. */
export async function waterReports(host, water, view) {
  const labels = {
    low_water: t('water_reports.low_water'),
    fish_deaths: t('water_reports.fish_deaths'),
    closure: t('water_reports.reported_closure'),
  };
  const status = document.createElement('p');
  status.setAttribute('role','status');
  host.replaceChildren(status);
  try {
    const alerts = await rpc('water_alerts',{water_key:water});
    if (!view.active()) return;
    status.textContent = t('water_reports.angler_observations_in_the_last_24_hours');
    for (const [kind,label] of Object.entries(labels)) {
      const {count=0,mine=false} = alerts[kind] || {};
      const row = document.createElement('p');
      const corroborated = count >= 3;
      if (corroborated) row.className = 'water-alert';
      const text = document.createElement(corroborated ? 'strong' : 'span');
      text.textContent = label + ' · ' + (corroborated ? t('water_reports.multiple_reports') : count ? t('water_reports.unconfirmed') : t('water_reports.no_reports')) + ' (' + count + ') ';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mine ? t('water_reports.withdraw_report') : t('water_reports.report_my_observation');
      button.onclick = async () => {
        if (!await confirmAction({title:label,message:button.textContent,accept:button.textContent}) || !view.active()) return;
        for (const control of host.querySelectorAll('button')) control.disabled=true;
        try {
          await rpc('water_report',{water_key:water,kind,withdraw:mine});
          if(view.active()) await waterReports(host,water,view);
        } catch {
          for (const control of host.querySelectorAll('button')) control.disabled=false;
          if(view.active()) status.textContent=t('water_reports.check_the_report_after_refreshing');
        }
      };
      row.append(text,button);
      host.append(row);
    }
  } catch {
    if(view.active()) status.textContent=t('water_reports.reports_could_not_be_loaded');
  }
}
