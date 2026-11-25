/** Exercise the installed WebView, its native authenticated RPC bridge and on-device IndexedDB. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [pkg, stage, dir] = process.argv.slice(2);
const adb = (...args) => execFileSync('adb', args, {encoding:'utf8', timeout:12000}).trim();
const fixtureFile = join(dir,'journal-device.json');

async function connect() {
  let port;
  for (let attempt=0; attempt<90; attempt++) {
    try {
      const pid = adb('shell','pidof',pkg);
      if (!port) port = adb('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
      const targets = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
      const target = targets.find(t => t.url === 'https://journal.invalid/index.html');
      if (target) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
        return {port,socket};
      }
    } catch { /* The app may still be opening its first authenticated WebView. */ }
    await delay(400);
  }
  throw Error('Authenticated journal did not open for '+pkg);
}

const {port,socket} = await connect();
let sequence=0;
function command(method,params) {
  const id=++sequence;
  return new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>{ socket.removeEventListener('message',receive); reject(Error('Timed out: '+method)); },50000);
    function receive(event) {
      const reply=JSON.parse(event.data);
      if (reply.id!==id) return;
      clearTimeout(timeout); socket.removeEventListener('message',receive);
      if (reply.error) reject(Error(reply.error.message)); else resolve(reply.result);
    }
    socket.addEventListener('message',receive);
    socket.send(JSON.stringify({method,params,id}));
  });
}

/** Run against the same entry points used by the journal and the private profile form. */
async function onPhone(action, fixture) {
  const until=async(test,label)=>{
    const deadline=Date.now()+30000;
    do {
      const result=await test();
      if (result) return result;
      await new Promise(r=>setTimeout(r,100));
    } while (Date.now()<deadline);
    throw Error('Missing '+label+' (sync: '+document.querySelector('#journal-sync')?.dataset.state+')');
  };
  const el=selector=>document.querySelector(selector);
  const click=async selector=>(await until(()=>el(selector+':not(:disabled)'),selector)).click();
  const state=name=>until(()=>el('#journal-sync')?.dataset.state===name,name);
  const assert=(test,message)=>{if(!test) throw Error(message);};
  await until(()=>el('#tabtrips'),'journal navigation');
  const {Journal}=await import('./journal.js');
  const {rpc}=await import('./profile-api.js');
  const {label}=await import('./i18n.js');
  const id='device-restore', fish='device-catch';
  const openJournal=async()=>{
    await click('#tabtrips');
    await until(()=>el('#journal-sync'),'sync panel');
  };
  const button=action=>'[data-action="sync.'+action+'"]';
  const confirm=async action=>{await click(button(action));await click('#confirmation[open] #confirmation-accept');};
  const dateAfter=days=>{const d=new Date(); d.setDate(d.getDate()+days);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  async function saveLicence(expiry,lead) {
    await click('#profile'); await click('#private-details'); await until(()=>el('#permit-expiry'),'licence form');
    el('#angler-age').value='48'; el('#permit-expiry').value=expiry;
    el('#permit-expiry').dispatchEvent(new Event('input',{bubbles:true}));
    el('#permit-lead').value=lead; el('#permit-lead').dispatchEvent(new Event('change',{bubbles:true}));
    await click('#details-form button[type=submit]');
    await until(()=>el('#private-summary')?.textContent.includes('48'),'saved private details');
    const saved=await rpc('my_details');
    assert(saved.expiry===expiry && saved.reminder===lead,'Licence does not match the saved form');
  }
  // Report only facts about this synthetic trip; never log account IDs, credentials or journal contents.
  const historyState = async () => ({
    local: !!await Journal.trip('historical'),
    remote: (await rpc('journal_sync', {op:'list', args:{}})).rows.some(row => row.key === 'trip/historical'),
    deviceChoice: localStorage.getItem('journal.sync.v1.' + Device.subjectId() + '.enabled'),
    registrationDefault: Device.journalCloudDefault(),
    state: el('#journal-sync')?.dataset.state
  });
  if (!el('#journal-sync')) await openJournal();
  if (action==='ready') { await state('done'); return; }
  if (action==='offline') {
    await state('offline');
    const canvas=document.createElement('canvas'); canvas.width=32; canvas.height=32;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#38735f';ctx.fillRect(0,0,32,32);
    const photo=await new Promise(r=>canvas.toBlob(r,'image/jpeg'));
    const trip={id,day:'2026-11-24',waterName:'Test Brook',notes:'Written offline',created:100};
    await Journal.saveTrip(trip);
    await Journal.saveCatch({id:fish,tripId:id,speciesName:'Perch',created:101,position:{lat:48.1,lon:14.2}},photo);
    return {photo:Array.from(new Uint8Array(await photo.arrayBuffer()))};
  }
  if (action==='failure') { await state('failed'); assert(el(button('retry')),'Manual retry missing'); return; }
  if (action==='upload') {
    await click(button('retry')); await state('done');
    assert(el('#journal-sync').textContent.includes(label('sync.saved_at').split('{time}')[0]),'Missing account save time');
    const rows=(await rpc('journal_sync',{op:'list',args:{}})).rows.filter(r=>r.key==='trip/'+id);
    assert(rows.length===1 && rows[0].revision===1,'Duplicate or missing upload');
    await confirm('pause'); await state('disabled');
    await saveLicence(dateAfter(3),'week');
    await until(()=>Device.licenseMessage(),'due licence reminder');
    return {part:rows[0].parts[0],expiry:dateAfter(3)};
  }
  if (action==='isolation') {
    const rows=(await rpc('journal_sync',{op:'list',args:{}})).rows;
    assert(!rows.some(r=>r.key==='trip/'+id) && !(await Journal.trip(id)),'Other user saw the trip');
    let denied=false;
    try {await rpc('journal_sync',{op:'get',args:{hash:fixture.part}});} catch {denied=true;}
    assert(denied && !(await rpc('my_details')).expiry,'Other user accessed private bytes or profile');
    // Reproduce an upgrade from a local-only journal, while another device already syncs this account.
    const initial = await until(() => {
      const value = el('#journal-sync').dataset.state;
      return ['disabled', 'done'].includes(value) && value;
    }, 'initial sync decision');
    if (initial === 'done') await confirm('pause');
    await state('disabled');
    await Journal.saveTrip({id:'historical',day:'2025-07-01',waterName:'Old private water',created:1});
    await rpc('journal_sync',{op:'enable',args:{}});
    localStorage.removeItem('journal.sync.v1.'+Device.subjectId()+'.enabled');
    const prepared = await historyState();
    assert(prepared.local && !prepared.remote && prepared.deviceChoice === null,
      'Invalid pre-upgrade fixture: ' + JSON.stringify(prepared));
    return {prepared};
  }
  if (action==='consent') {
    try {
      await state('disabled');
    } catch (error) {
      throw Error(error.message + '; before restart ' + JSON.stringify(fixture.prepared)
        + '; after restart ' + JSON.stringify(await historyState()));
    }
    const list=async()=>(await rpc('journal_sync',{op:'list',args:{}})).rows;
    assert(await Journal.trip('historical') && !(await list()).some(r=>r.key==='trip/historical'),'Historical journal uploaded before consent');
    await click(button('enable')); await click('#confirmation[open] #confirmation-cancel');
    assert(!(await list()).some(r=>r.key==='trip/historical'),'Cancel uploaded a private trip');
    await confirm('enable'); await state('done');
    assert((await list()).some(r=>r.key==='trip/historical'),'Consent did not enable migration');
    return;
  }
  if (action==='restore') {
    await state('done');
    await until(async()=>(await Journal.trip(id))?.notes==='Written offline','restored trip');
    await click(button('retry')); await state('done');
    const trips=await Journal.listTrips(), catches=await Journal.catches(id), photo=await Journal.photo(fish);
    assert(trips.filter(t=>t.id===id).length===1 && catches.length===1 && catches[0].id===fish,'Duplicate trip or catch');
    assert(catches[0].position.lon===14.2 && catches[0].speciesName==='Perch','Catch details changed');
    assert(photo.type==='image/jpeg' && JSON.stringify(Array.from(new Uint8Array(await photo.arrayBuffer())))===JSON.stringify(fixture.photo),'Photo bytes changed');
    const details=await rpc('my_details');
    assert(details.expiry===fixture.expiry && details.reminder==='week' && details.age===48,'Licence did not restore');
    await Journal.saveTrip({...await Journal.trip(id),notes:'Updated on the second installation'});
    await state('done');
    await until(()=>Device.licenseMessage(),'restored licence reminder');
    return;
  }
  if (action==='renew') {
    await saveLicence(dateAfter(90),'month');
    await until(()=>!Device.licenseMessage(),'rescheduled licence');
    return {renewed:dateAfter(90)};
  }
  if (action==='resolve') {
    await state('disabled');
    await Journal.saveTrip({...await Journal.trip(id),notes:'Concurrent edit on first installation'});
    await confirm('enable'); await state('conflict');
    const text=el('#journal-sync').textContent;
    const {displayDay}=await import('./ui.js');
    assert(text.includes('Test Brook') && text.includes(displayDay('2026-11-24')) && !text.includes('trip/'+id),'Unreadable conflict');
    await confirm('cloud');
    await until(async()=>(await Journal.trip(id))?.notes==='Updated on the second installation','chosen revision');
    await state('done');
    const saved=await rpc('my_details');
    assert(saved.expiry===fixture.renewed && saved.reminder==='month' && !Device.licenseMessage(),'Old reminder survived renewal');
  }
}

let disconnected=false;
try {
  const fixture=stage==='seed'?{}:JSON.parse(await readFile(fixtureFile,'utf8'));
  async function step(action) {
    const expression='('+onPhone.toString()+')('+JSON.stringify(action)+','+JSON.stringify(fixture)+')';
    const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || 'Journal scenario failed');
    Object.assign(fixture,result.result.value);
    console.log(pkg+' / '+action+' passed');
  }
  if (stage==='seed') {
    await step('ready');
    await command('Network.enable',{});
    adb('reverse','--remove','tcp:58443'); disconnected=true;
    const network=offline=>command('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await network(true); await step('offline'); await network(false); await step('failure');
    adb('reverse','tcp:58443','tcp:58443'); disconnected=false;
    await step('upload');
  } else await step(stage);
  if (stage==='seed' || stage==='renew' || stage==='isolation') await writeFile(fixtureFile,JSON.stringify(fixture),{mode:0o600});
} finally {
  if (disconnected) adb('reverse','tcp:58443','tcp:58443');
  socket.close(); adb('forward','--remove','tcp:'+port);
}
