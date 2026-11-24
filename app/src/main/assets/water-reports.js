import { rpc } from './profile-api.js';
import { t, confirmAction } from './ui.js';

/** Counts come from distinct verified accounts in the last 24 hours. */
export async function waterReports(host, water, view) {
  const labels = {
    low_water: t('Nízký stav vody','Low water'),
    fish_deaths: t('Úhyn ryb','Fish deaths'),
    closure: t('Pozorované uzavření','Reported closure'),
  };
  const status = document.createElement('p');
  status.setAttribute('role','status');
  host.replaceChildren(status);
  try {
    const alerts = await rpc('water_alerts',{water_key:water});
    if (!view.active()) return;
    status.textContent = t('Pozorování rybářů za posledních 24 hodin. Úřední omezení ověř u správce.', 'Angler observations in the last 24 hours. Check official restrictions with the manager.');
    for (const [kind,label] of Object.entries(labels)) {
      const {count=0,mine=false} = alerts[kind] || {};
      const row = document.createElement('p');
      const text = document.createElement(count >= 3 ? 'strong' : 'span');
      text.textContent = label + ' · ' + (count >= 3 ? t('Opakovaně hlášeno','Multiple reports') : count ? t('Nepotvrzeno','Unconfirmed') : t('Bez hlášení','No reports')) + ' (' + count + ') ';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mine ? t('Stáhnout hlášení','Withdraw report') : t('Hlásím vlastní pozorování','Report my observation');
      button.onclick = async () => {
        if (!await confirmAction({title:label,message:button.textContent,accept:button.textContent}) || !view.active()) return;
        for (const control of host.querySelectorAll('button')) control.disabled=true;
        try {
          await rpc('water_report',{water_key:water,kind,withdraw:mine});
          if(view.active()) await waterReports(host,water,view);
        } catch {
          for (const control of host.querySelectorAll('button')) control.disabled=false;
          if(view.active()) status.textContent=t('Ověř stav hlášení po obnovení.', 'Check the report after refreshing.');
        }
      };
      row.append(text,button);
      host.append(row);
    }
  } catch {
    if(view.active()) status.textContent=t('Hlášení se nepodařilo načíst.', 'Reports could not be loaded.');
  }
}
