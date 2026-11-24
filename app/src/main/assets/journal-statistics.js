import { Journal } from './journal.js';
import { catchLatin } from './catch-species.js';
import { fishDirectory } from './fish-catalogue.js';
import { rpc, failure } from './profile-api.js';
import { back, bindBack, by, button, esc, screen, t } from './ui.js';

function add(counts, key, label) {
  const row=counts.get(key);
  if(row)row.count++;
  else counts.set(key,{label,count:1});
}
const ranked=counts=>[...counts.values()].sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label));

/** Preserve distinct catalogue identities even when two waters have the same name. */
export function personalTotals(trips,catches,pack,fish) {
  const waters=new Map(), species=new Map();
  for(const trip of trips) add(waters,trip.waterId?JSON.stringify([trip.country,trip.waterId]):'manual:'+trip.waterName,trip.waterName);
  for(const entry of catches) {
    const latin=catchLatin(entry,pack,fish);
    const label=fish?.names.get(latin)?.label || entry.speciesName || entry.speciesId;
    if(label)add(species,latin || entry.speciesId || 'manual:'+entry.speciesName,label);
  }
  return {waters:ranked(waters),species:ranked(species)};
}
function list(rows) {
  return rows.length ? '<ol>'+rows.slice(0,10).map(r=>'<li>'+esc(r.label)+' · <strong>'+r.count+'</strong></li>').join('')+'</ol>'
    : '<p>'+esc(t('stats.empty'))+'</p>';
}

export async function journalStatistics({view,nav,pack,waterDirectory}) {
  const [entries,fish]=await Promise.all([Journal.statEntries(),fishDirectory().catch(()=>null)]);
  if(!view.active())return;
  const totals=personalTotals(entries.trips,entries.catches,pack,fish);
  screen.innerHTML=back(t('trips.my_journal'))+'<h1>'+t('stats.title')+'</h1><p>'+t('trips.private_on_this_phone')+'</p>'+
    '<section class="surface"><h2>'+t('stats.visits')+'</h2>'+list(totals.waters)+'</section>'+
    '<section class="surface"><h2>'+t('stats.species')+'</h2>'+list(totals.species)+'</section>'+
    '<details id="community-stats" class="fold"><summary>'+t('stats.community')+'</summary><div id="shared-visits" class="fold-body"></div></details>';
  bindBack(nav);
  const panel=by('community-stats'), body=by('shared-visits');
  let loading=false, loaded=false;
  async function refresh() {
    if(loading || loaded)return;
    loading=true;body.textContent=t('messages.loading');
    try{
      const [result,actual]=await Promise.all([rpc('top_waters'),rpc('top_species')]);
      if(!view.active())return;
      const rows=result.waters.map(r=>({label:waterDirectory.byKey.get(r.water)?.name || r.water,count:r.visits}));
      body.innerHTML='<h3>'+t('stats.shared_visits')+'</h3><p>'+esc(result.month.slice(0,7))+' · '+t('stats.shared_sample')+'</p>'+list(rows)+'<h3>'+t('stats.shared_species')+'</h3>'+list(actual.species.map(r=>({label:fish?.names.get(r.latin)?.label || r.latin,count:r.fish})));loaded=true;
    }catch(err){if(view.active()){body.innerHTML='<p>'+esc(failure(err))+'</p>'+button('retry-stats',t('common.retry'),'secondary');by('retry-stats').onclick=refresh;}}
    finally{loading=false;}
  }
  panel.ontoggle=()=>{if(panel.open)refresh();};
}
