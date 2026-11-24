import { rpc, failure } from './profile-api.js';
import { button, displayDay, esc, link, selectField, t } from './ui.js';

let parking;
async function parkingPoints() {
  parking ||= fetch('parking.json').then(r=>{if(!r.ok)throw Error('parking');return r.json();})
    .catch(e=>{parking=null;throw e;});
  return parking;
}

export async function waterParking(host,water) {
  const title='<h2>'+esc(t('parking.title'))+'</h2>';
  try {
    const points=(await parkingPoints())[water.key] || [];
    if(!host.isConnected)return;
    host.innerHTML=title+points.map((p,i)=>'<h3>'+esc(t(p.label))+'</h3><p>'+esc(t('parking.signs'))+'</p>'+
      '<p class="meta">'+link(p.source,t('waters.access_point_source'))+' · '+esc(displayDay(p.checked))+'</p>'+
      button('drive-'+i,t('parking.drive'),'primary','navigation')).join('')+
      (points.length?'':'<p>'+esc(t('parking.missing'))+'</p>');
    points.forEach((p,i)=>host.querySelector('#drive-'+i).onclick=()=>{
      if(window.Device?.driveToParking)window.Device.driveToParking(p.point[1],p.point[0]);
      else host.querySelector('#drive-'+i+' span').textContent=p.point.slice().reverse().join(', ');
    });
  } catch {host.innerHTML=title+'<p>'+esc(t('parking.unavailable'))+'</p>';}
  const feedback=document.createElement('a');
  feedback.href='mailto:info@horistum.com?subject='+encodeURIComponent(t('parking.feedback')+' · '+water.key+' · '+water.name);
  feedback.onclick=e=>{if(window.Device?.reportFish){e.preventDefault();Device.reportFish(t('parking.feedback'),water.key+' · '+water.name);}};
  feedback.textContent=t('parking.feedback');host.append(feedback);
}

export async function waterRating(host,water) {
  const heading='<h2>'+esc(t('rating.title'))+'</h2>';
  async function load(operation='water_rating',args={}) {
    host.setAttribute('aria-busy','true');
    try{
      const data=await rpc(operation,{water_key:water.key,...args});
      if(!host.isConnected)return;
      if(!Number.isInteger(data?.count))throw Error('Unexpected rating response');
      host.innerHTML=heading+'<p role="status">'+(data.count ? esc(Number(data.average).toLocaleString())+' / 5 · '+esc(t('common.ratings'))+' '+data.count : esc(t('common.no_ratings_yet')))+'</p>'+
        selectField('water-stars',t('rating.mine'),[['',t('rating.choose')],...[1,2,3,4,5].map(n=>[String(n),n+' / 5'])],String(data.mine??''))+
        button('save-stars',t('rating.save'),'secondary')+(data.mine?button('clear-stars',t('rating.withdraw'),'secondary'):'');
      const field=host.querySelector('select'),save=host.querySelector('#save-stars');
      save.disabled=true;
      field.onchange=()=>save.disabled=!field.value || Number(field.value)===data.mine;
      save.onclick=()=>write(Number(field.value));
      if(data.mine)host.querySelector('#clear-stars').onclick=()=>write(null);
    } catch(e){
      if(!host.isConnected)return;
      host.innerHTML=heading+'<p role="status">'+esc(failure(e))+'</p>'+button('retry-stars',t('common.retry'),'secondary');
      host.querySelector('button').onclick=()=>load();
    } finally {host.removeAttribute('aria-busy');}
  }
  function write(stars){host.querySelectorAll('select,button').forEach(el=>el.disabled=true);load('water_rate',{stars});}
  await load();
}
