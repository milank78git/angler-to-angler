'use strict';
const screen=document.querySelector('#screen'),tabs=document.querySelector('#tabs');
const cs=(window.Device?Device.locale():navigator.language).toLowerCase().startsWith('cs');
const t=(cz,en)=>cs?cz:en, loc=obj=>obj[cs?'cs':'en'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const by=id=>document.getElementById(id);
let pack,rivers,route={page:'waters'},draft=false,noticeTimer,viewVersion=0;
let disposeView=()=>{};
const button=(id,label,cls='')=>'<button type="button" class="'+cls+'" id="'+id+'">'+esc(label)+'</button>';
const link=(url,label)=>'<a href="'+esc(url)+'">'+esc(label)+'</a>';
const options=(pairs,sel)=>pairs.map(([val,label])=>'<option value="'+esc(val)+'"'+(val===sel?' selected':'')+'>'+esc(label)+'</option>').join('');
function bind(id,fn){by(id).onclick=fn;}
function toast(message){by('notice').textContent=message;by('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>by('notice').hidden=true,4600);}
function mayLeave(){return !draft || confirm(t('Zahodit neuložené změny?','Discard unsaved changes?'));}
function go(page,props={}){
  if(!mayLeave()) return;
  disposeView();disposeView=()=>{};draft=false;route={page,...props};viewVersion++;
  const library=['waters','water'].includes(page);
  by('tabwaters').className=library?'active':'';by('tabtrips').className=library?'':'active';
  by('tabwaters').setAttribute('aria-current',library?'page':'false');by('tabtrips').setAttribute('aria-current',library?'false':'page');
  const render={waters:listWaters,water:waterScreen,trips:listTrips,trip:tripScreen,newTrip:tripForm,newCatch:catchForm};
  Promise.resolve().then(()=>render[page]()).catch(()=>toast(t('Záznam se nepodařilo načíst.','The record could not be loaded.')));
  window.scrollTo(0,0);
}
function handleBack(){
  if(route.page==='waters')return false;
  const dest={water:['waters'],trips:['waters'],newTrip:route.water?['water',{id:route.water}]:['trips'],trip:['trips'],newCatch:['trip',{id:route.id}]}[route.page];
  if(dest) go(...dest);
  return true;
}
function back(label){return button('back','‹  '+label,'back');}
function bindBack(){bind('back',handleBack);}
function listWaters(){
  screen.innerHTML='<h1>'+t('Revíry','Fishing waters')+'</h1><label for="search">'+t('Název, číslo revíru nebo obec','Name, water number or town')+'</label><input type="search" id="search" placeholder="Sázava, 401 009…"><p class="meta act">'+t('Česko · podklady uložené v telefonu','Czechia · available offline')+'</p><div id="waters"></div>';
  const render=()=>{
    const q=Domain.fold(by('search').value);
    const matches=pack.waters.filter(w=>Domain.fold(w.name+' '+w.id+' '+w.area).includes(q));
    by('waters').innerHTML=matches.map(w=>'<button class="tile" data-water="'+w.id+'"><span class="meta">'+w.id.slice(0,3)+' '+w.id.slice(3)+'</span><strong>'+esc(w.name)+'</strong><span>'+esc(w.area)+'</span></button>').join('') || '<p>'+t('Tento revír v balíčku není. V deníku můžeš zadat vlastní vodu.','No matching water in this pack. You can enter any water in your journal.')+'</p>';
    by('waters').querySelectorAll('button').forEach(b=>b.onclick=()=>go('water',{id:b.dataset.water}));
  };
  by('search').oninput=render; render();
}
/** Projects coordinates at local latitude using equal horizontal and vertical distance scales. */
function waterMap(w){
  const lines=rivers[w.id], pts=w.bounds.concat([w.danger],w.access?[w.access.pt]:[]);
  const cos=Math.cos(pts[0][1]*Math.PI/180);
  const xs=pts.map(p=>p[0]*cos),ys=pts.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const scale=Math.min(292/(Math.max(...xs)-Math.min(...xs)),120/(Math.max(...ys)-Math.min(...ys)));
  const xy=p=>[(170+(p[0]*cos-cx)*scale).toFixed(1),(85-(p[1]-cy)*scale).toFixed(1)];
  const path=lines.map(line=>'<polyline points="'+line.map(p=>xy(p).join(',')).join(' ')+'" fill="none" stroke="#57978d" stroke-width="5" stroke-linejoin="round"/>').join('');
  function marker(p,text,color){const [x,y]=xy(p);return '<g transform="translate('+x+' '+y+')"><circle r="9" fill="'+color+'" stroke="white" stroke-width="1.7"/><text y="3.8" text-anchor="middle" fill="white" font-size="11" font-weight="bold">'+text+'</text></g>';}
  return '<figure><svg aria-label="'+t('Orientační mapa toku a hranic','Overview of river and boundary points')+'" role="img" viewBox="0 0 340 170"><defs><pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#cbd8cd" stroke-width=".8"/></pattern></defs><rect width="340" height="170" fill="url(#grid)"/>'+path+marker(w.bounds[0],'1','#294f43')+marker(w.bounds[1],'2','#294f43')+marker(w.danger,'!','#9c4736')+(w.access?marker(w.access.pt,'A','#33668c'):'')+'<text x="315" y="21" font-size="12" fill="#476554">↑ N</text></svg><figcaption>'+link('https://www.openstreetmap.org/copyright','© OpenStreetMap contributors · ODbL')+'</figcaption></figure>';
}
function waterScreen(){
  const w=pack.waters.find(v=>v.id===route.id);
  screen.innerHTML=back(t('Revíry','Waters'))+'<p class="meta">'+pack.country+' · '+w.id+'</p><h1>'+esc(w.name)+'</h1>'+waterMap(w)+'<p class="meta act">1 · '+esc(loc(w.ends[0]))+'<br>2 · '+esc(loc(w.ends[1]))+'<br>! · '+esc(loc(w.restriction))+'</p>'
    +(w.access?'<div class="panel"><h3>A · '+esc(loc(w.access))+'</h3><div class="actions">'+button('navigate',t('Navigovat k přístupu','Directions to access point'))+'</div>'+link(w.access.source,t('Zdroj přístupového bodu','Access point source'))+'</div>':'<p class="quiet">'+t('Pro tento revír zatím nemáme ověřený přístupový bod.','There is no verified access point for this water in the pack.')+'</p>')
    +button('new-trip',t('Zapsat výpravu','Log a trip'),'primary act')+'<h2>'+t('Hájení a míry','Seasons and sizes')+'</h2><label for="section">'+t('Úsek','Section')+'</label><select id="section">'+options([['main',t('Hlavní tok','Main river')],['restricted',loc(w.restriction)],['other',t('Jiný úsek / přítok','Other section / tributary')]],'main')+'</select>'
    +'<div class="pair"><div><label for="species">'+t('Druh','Species')+'</label><select id="species">'+options(Object.entries(pack.species).map(([k,v])=>[k,loc(v)]),'pike')+'</select></div><div><label for="rule-date">'+t('Datum lovu','Fishing date')+'</label><input type="date" id="rule-date" value="'+Domain.today(pack.zone)+'"></div></div><div id="status" aria-live="polite"></div><div id="watch"></div><p class="meta act">'+t('Výběr pravidel pro čtyři druhy. Ověř si také další místní omezení.','Selected rules for four species. Check other local restrictions as well.')+'<br>'+t('Podklady ověřeny','Sources checked')+' '+pack.revision+' · '+t('platnost do','valid through')+' '+pack.until+'</p><div class="rulesrc">'+link(w.source,t('Karta revíru ČRS','Fishery authority'))+link(pack.law,t('Vyhláška · § 13','National closed seasons'))+'</div>';
  bindBack();bind('new-trip',()=>go('newTrip',{water:w.id}));
  if(w.access) bind('navigate',()=>window.Device?Device.navigate(w.access.pt[1],w.access.pt[0]):toast(t('Navigace je dostupná v aplikaci pro Android.','Navigation is available on Android.')));
  ['section','species','rule-date'].forEach(k=>by(k).onchange=()=>ruleResult(w));
  ruleResult(w);
}
function ruleResult(w){
  const section=by('section').value,s=by('species').value,day=by('rule-date').value;
  const status=Domain.season(pack,s,section,day);
  const labels={closed:t('Ryba je hájená','Closed season'),outside:t('Mimo uvedenou dobu hájení','Outside the listed closed season'),unknown:t('Pro tuto volbu chybí ověřené pravidlo','No verified rule for this selection'),prohibited:t('V tomto úseku je lov zakázán','Fishing is prohibited in this section')};
  const valid=status==='closed'||status==='outside';
  const windowLabel=pack.species[s].window.map(d=>new Intl.DateTimeFormat(cs?'cs-CZ':'en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date('2000-'+d+'T12:00Z'))).join(' – ');
  by('status').innerHTML='<div class="panel result '+status+'"><strong>'+labels[status]+'</strong>'+(valid?'<p>'+windowLabel+(w.size[s]?' · '+t('nejmenší míra','minimum size')+' '+w.size[s]+' cm':'')+'</p>':'')+'</div>';
  const key=w.id+'/'+s;
  by('watch').innerHTML='';
  if(!window.Device||section!=='main') return;
  const watching=Device.watching(key),today=Domain.today(pack.zone);
  if(!watching&&(today>pack.until||today<pack.from))return;
  by('watch').innerHTML=button('watch-toggle',watching?t('Vypnout připomínky','Stop reminders'):t('Připomínat změny hájení','Remind me of season changes'))+'<p class="meta">'+t('Pro hlavní tok. Telefon připomene také konec platnosti podkladů.','For the main river. Includes a reminder when the local rules pack expires.')+'</p>';
  bind('watch-toggle',()=>Device.reminder(key,!watching));
}
function reminderChanged(){if(route.page==='water')ruleResult(pack.waters.find(w=>w.id===route.id));}
async function start(){
  document.documentElement.lang=cs?'cs':'en';by('brand').textContent=t('Rybáři sobě','Angler to Angler');
  try {
    [pack,rivers]=await Promise.all(['catalog.json','rivers.json'].map(p=>fetch(p).then(r=>r.json())));
    await Journal.open();
    tabs.innerHTML=button('tabwaters',t('Revíry','Waters'))+button('tabtrips',t('Můj deník','My journal'));tabs.hidden=false;
    bind('tabwaters',()=>go('waters'));bind('tabtrips',()=>go('trips'));go('waters');
  } catch(e){screen.textContent=t('Místní data se nepodařilo otevřít. Zkus aplikaci znovu spustit.','Local data could not be opened. Try restarting the app.');}
}
window.addEventListener('DOMContentLoaded',start);
