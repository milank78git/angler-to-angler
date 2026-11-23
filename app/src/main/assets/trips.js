'use strict';
const uid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const tripName=r=>r.waterName;
const displayDay=day=>new Intl.DateTimeFormat(cs?'cs-CZ':'en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
function field(id,label,html){return '<label for="'+id+'">'+esc(label)+'</label>'+html;}
function textInput(id,label,value='',attrs=''){return field(id,label,'<input id="'+id+'" value="'+esc(value)+'" '+attrs+'>');}
function dirty(form){form.oninput=()=>{draft=true;};}
function saved(page,props){draft=false;go(page,props);}
async function listTrips(){
  const version=viewVersion,trips=await Journal.trips(); if(version!==viewVersion)return;
  trips.sort((a,b)=>b.day.localeCompare(a.day)||b.created-a.created);
  screen.innerHTML='<h1>'+t('Můj deník','My journal')+'</h1><p class="quiet">'+t('Výpravy, fotografie a souřadnice zůstávají v tomto telefonu.','Trips, photos and coordinates stay on this phone.')+'</p><div class="actions">'+button('add-trip',t('Nová výprava','New trip'),'primary')+'</div>'
    +(trips.length?trips.map(r=>'<button class="tile" data-trip="'+esc(r.id)+'"><span class="meta">'+esc(displayDay(r.day))+'</span><strong>'+esc(tripName(r))+'</strong>'+(r.notes?'<span>'+esc(r.notes.slice(0,100))+'</span>':'')+'</button>').join(''):'<p class="empty">'+t('Sem můžeš zapsat i vycházku bez úlovku.','You can log a day on the water even without a catch.')+'</p>');
  bind('add-trip',()=>go('newTrip'));screen.querySelectorAll('[data-trip]').forEach(b=>b.onclick=()=>go('trip',{id:b.dataset.trip}));
}
function tripForm(){
  const selected=route.water||'';
  screen.innerHTML=back(t('Zpět','Back'))+'<h1>'+t('Nová výprava','New trip')+'</h1><form id="form">'+field('water',t('Revír nebo voda','Fishing water'),'<select id="water">'+options([['',t('Vlastní voda','Other water')],...pack.waters.map(w=>[w.id,w.name])],selected)+'</select>')+'<div id="custom">'+textInput('water-name',t('Název vody','Water name'),'','maxlength="100"')+'</div>'
    +textInput('day',t('Datum výpravy','Trip date'),Domain.today(selected?pack.zone:undefined),'type="date" required')+field('notes',t('Poznámka k výpravě','Trip notes'),'<textarea maxlength="4000" id="notes"></textarea>')+'<div class="actions"><button class="primary">'+t('Uložit výpravu','Save trip')+'</button></div></form>';
  bindBack();dirty(by('form'));
  function custom(){by('custom').hidden=!!by('water').value;by('water-name').required=!by('water').value;}
  by('water').onchange=custom;custom();
  const id=uid(),created=Date.now();
  by('form').onsubmit=async e=>{
    e.preventDefault();const w=pack.waters.find(w=>w.id===by('water').value),name=w?w.name:by('water-name').value.trim(),day=by('day').value;
    if(!name||!Domain.validDay(day)){toast(t('Vyplň název vody a datum.','Enter a water name and a valid date.'));return;}
    const submit=e.target.querySelector('.primary');submit.disabled=true;
    try{await Journal.saveTrip({id,created,waterId:w?w.id:null,country:w?pack.country:null,zone:w?pack.zone:Intl.DateTimeFormat().resolvedOptions().timeZone,waterName:name,day,notes:by('notes').value.trim()});saved('trip',{id});}
    catch(err){submit.disabled=false;toast(t('Uložení selhalo. Zápis můžeš zkusit znovu.','Saving failed. You can retry.'));}
  };
}
async function tripScreen(){
  const version=viewVersion,id=route.id;
  const [trip,catches]=await Promise.all([Journal.trip(id),Journal.catches(id)]);
  if(version!==viewVersion)return;if(!trip){go('trips');return;}
  const images=[],cleanup=()=>images.forEach(url=>URL.revokeObjectURL(url));disposeView=cleanup;
  screen.innerHTML=back(t('Můj deník','My journal'))+'<p class="meta">'+displayDay(trip.day)+'</p><h1>'+esc(trip.waterName)+'</h1>'+(trip.notes?'<p>'+esc(trip.notes)+'</p>':'')+'<div class="actions">'+button('add',t('Přidat úlovek','Add catch'),'primary')+'</div><h2>'+t('Úlovky','Catches')+' · '+catches.length+'</h2><div id="catch-list"></div><div class="actions">'+button('delete',t('Smazat výpravu','Delete trip'),'danger')+'</div>';
  bindBack();bind('add',()=>go('newCatch',{id}));bind('delete',async()=>{
    if(!confirm(t('Smazat tuto výpravu včetně úlovků, fotek a souřadnic?','Delete this trip with all catches, photos and coordinates?'))) return;
    try{await Journal.removeTrip(id);saved('trips');}catch(e){toast(t('Smazání selhalo.','Deletion failed.'));}
  });
  by('catch-list').innerHTML=catches.length?'':'<p class="empty">'+t('Zapsaná výprava bez úlovku.','A trip with no catches recorded.')+'</p>';
  for(const c of catches.sort((a,b)=>a.created-b.created)){
    const article=document.createElement('article');article.className='panel';by('catch-list').append(article);
    const position=c.position, label=position?.kind==='strike'?t('Místo záběru','Strike location'):t('Stanoviště rybáře','Angler position');
    const fmt=n=>new Intl.NumberFormat(cs?'cs-CZ':'en-GB',{maximumFractionDigits:1}).format(n);
    article.innerHTML='<h3>'+esc(c.speciesId?loc(pack.species[c.speciesId]):c.speciesName)+'</h3>'+(c.lengthMm?'<p>'+fmt(c.lengthMm/10)+' cm · '+t('ruční zápis','manually entered')+'</p>':'')
      +(c.bait?'<p>'+t('Nástraha','Bait')+' · '+esc(c.bait)+'</p>':'')+(c.technique?'<p>'+t('Technika','Technique')+' · '+esc(c.technique)+'</p>':'')
      +(position?'<p class="meta">'+label+' · '+position.lat.toFixed(5)+', '+position.lon.toFixed(5)+' · '+(position.source==='device'?'GPS':t('ručně','manual'))+(Number.isFinite(position.accuracy)?' ±'+Math.round(position.accuracy)+' m':'')+'</p>':'');
    if(c.hasPhoto){
      const blob=await Journal.photo(c.id);if(version!==viewVersion)return;
      if(blob){const url=URL.createObjectURL(blob);images.push(url);const img=new Image();img.className='preview';img.alt=t('Fotografie úlovku','Catch photograph');img.src=url;article.append(img);}
    }
  }
}
/** Decode and re-encode into pixels only, dropping source EXIF and location metadata. */
async function journalPhoto(file){
  if(!file)return null;
  if(file.size>30*1024*1024)throw Error('photo');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
    const ratio=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('photo')),'image/jpeg',.84));
  }finally{URL.revokeObjectURL(url);}
}
let currentFix=null, awaitingFix=false;
function positionResult(fix){
  if(route.page!=='newCatch'||!awaitingFix||!by('gps'))return;
  awaitingFix=false;by('gps').disabled=false;by('gps').textContent=t('Použít současnou polohu','Use current location');
  if(!fix)return;
  currentFix=fix;by('lat').value=fix.lat.toFixed(6);by('lon').value=fix.lon.toFixed(6);draft=true;
}
function catchForm(){
  const id=route.id,catchId=uid(),created=Date.now();currentFix=null;awaitingFix=false;
  disposeView=()=>{awaitingFix=false;currentFix=null;if(window.Device)Device.cancelLocation();};
  screen.innerHTML=back(t('Výprava','Trip'))+'<h1>'+t('Nový úlovek','New catch')+'</h1><form id="form">'+field('fish',t('Druh ryby','Fish species'),'<select id="fish">'+options([['',t('Vyber druh nebo napiš vlastní','Choose a species or enter your own')],...Object.entries(pack.species).map(([k,v])=>[k,loc(v)])],'')+'</select>')+'<div id="custom-fish">'+textInput('fish-name',t('Vlastní název druhu','Species name'),'','maxlength="100"')+'</div>'
    +textInput('length',t('Ručně změřená délka (cm)','Manually measured length (cm)'),'','inputmode="decimal" placeholder="64,5"')+textInput('bait',t('Na co zabral','Bait or lure'),'','maxlength="300"')+textInput('technique',t('Technika lovu','Fishing technique'),'','maxlength="500"')+field('photo',t('Fotografie úlovku','Catch photo'),'<input type="file" id="photo" accept="image/*">')+'<fieldset><legend>'+t('Soukromá poloha · volitelné','Private location · optional')+'</legend>'+field('kind',t('Co bod označuje','Point represents'),'<select id="kind">'+options([['stand',t('Stanoviště rybáře','Angler position')],['strike',t('Místo záběru','Strike location')]],'stand')+'</select>')
    +'<div class="pair"><div>'+textInput('lat',t('Šířka','Latitude'),'','inputmode="text" placeholder="49.8783"')+'</div><div>'+textInput('lon',t('Délka','Longitude'),'','inputmode="text" placeholder="14.4282"')+'</div></div><div class="act">'+button('gps',t('Použít současnou polohu','Use current location'))+'</div><small>'+t('U starší fotky zadej bod ručně nebo ho ponech prázdný.','For an older photo, enter its location manually or leave the point empty.')+'</small></fieldset><div class="actions"><button class="primary">'+t('Uložit úlovek','Save catch')+'</button></div></form>';
  bindBack();dirty(by('form'));by('fish-name').required=true;
  by('fish').onchange=()=>{by('custom-fish').hidden=!!by('fish').value;by('fish-name').required=!by('fish').value;};
  const clearFix=()=>{currentFix=null;awaitingFix=false;by('gps').disabled=false;by('gps').textContent=t('Použít současnou polohu','Use current location');if(window.Device)Device.cancelLocation();};
  by('lat').oninput=clearFix;by('lon').oninput=clearFix;
  bind('gps',()=>{
    if(!window.Device){toast(t('GPS je dostupná na Androidu.','GPS is available on Android.'));return;}
    awaitingFix=true;by('gps').disabled=true;by('gps').textContent=t('Hledám polohu…','Waiting for position…');Device.location();
  });
  by('form').onsubmit=async e=>{
    e.preventDefault();const submit=e.target.querySelector('.primary'); if(submit.disabled)return;
    const speciesId=by('fish').value,speciesName=by('fish-name').value.trim();
    if(!speciesId&&!speciesName){toast(t('Zadej druh ryby.','Enter a fish species.'));return;}
    let lengthMm,point;
    try{lengthMm=Domain.lengthMm(by('length').value);point=Domain.point(by('lat').value,by('lon').value);}
    catch(err){toast(err.message==='length'?t('Uveď kladnou délku v centimetrech.','Enter a positive length in centimetres.'):t('Zkontroluj obě souřadnice (šířka ±90°, délka ±180°).','Check both coordinates (latitude ±90°, longitude ±180°).'));return;}
    const position=point?{...point,source:currentFix?'device':'manual',accuracy:currentFix?.accuracy??null,time:currentFix?.time??Date.now(),kind:by('kind').value}:null;
    const file=by('photo').files[0],version=viewVersion;
    const record={id:catchId,tripId:id,created,speciesId:speciesId||null,speciesName:speciesId?null:speciesName,lengthMm,position,bait:by('bait').value.trim(),technique:by('technique').value.trim(),hasPhoto:!!file};
    submit.disabled=true;
    try{const photo=await journalPhoto(file);if(version!==viewVersion)return;await Journal.saveCatch(record,photo);if(version===viewVersion)saved('trip',{id});}
    catch(err){submit.disabled=false;toast(t('Úlovek se neuložil. Ověř volné místo a použij fotografii do 30 MB.','Could not save the catch. Check available space and use a photo under 30 MB.'));}
  };
}
