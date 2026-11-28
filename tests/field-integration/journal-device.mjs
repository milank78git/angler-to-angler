/** Exercise the installed WebView, its native authenticated RPC bridge and on-device IndexedDB. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { webviewControls } from './webview-controls.mjs';
import { waterOnPhone } from './water-on-device.mjs';
import { evidenceOnPhone } from './evidence-on-device.mjs';
import { communityOnPhone } from './community-on-device.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const [pkg, stage, dir] = process.argv.slice(2);
const adb = (...args) => execFileSync('adb', args, {encoding:'utf8', timeout:12000}).trim();
const fixtureFile = join(dir,'journal-device.json');

async function connect() {
  let port, attachedPid;
  for (let attempt=0; attempt<90; attempt++) {
    try {
      const pid = adb('shell','pidof',pkg);
      if (!pid) throw Error('Starting Android process');
      if (pid !== attachedPid) {
        if (port) adb('forward', '--remove', 'tcp:' + port);
        port = adb('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
        attachedPid = pid;
      }
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

/** The target can advertise the journal URL while its initial blank document is still active. */
async function waitForJournal() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const result = await command('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && document.visibilityState === 'visible' && !!document.querySelector('#tabtrips') && !!window.Device?.subjectId?.()",
        returnByValue: true
      });
      if (result.result?.value === true) return;
    } catch (error) {
      if (!/execution context (was destroyed|with given id)|cannot find context/i.test(error.message)) throw error;
    }
    await delay(100);
  }
  throw Error('Authenticated journal did not finish loading for ' + pkg);
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
  const state=name=>until(()=>el('#journal-sync')?.dataset.state===name,name);
  const assert=(test,message)=>{if(!test) throw Error(message);};
  /** Open compact sync details before using their recovery or consent controls. */
  const click=async selector=>{
    let target=await until(()=>el(selector+':not(:disabled)'),selector);
    if (target.closest('#journal-sync-details[hidden]')) {
      const toggle=await until(()=>el('#journal-sync-toggle:not([hidden]):not(:disabled)'),'sync details toggle');
      toggle.click();
      await until(()=>el('#journal-sync-details:not([hidden])'),'opened sync details');
      // A live synchronization result can replace the action while the panel opens.
      target=await until(()=>el(selector+':not(:disabled)'),selector);
    }
    assert(!target.closest('[hidden]') && target.getClientRects().length > 0 &&
      getComputedStyle(target).visibility !== 'hidden','Cannot activate hidden control '+selector);
    target.click();
  };
  await until(()=>el('#tabtrips'),'journal navigation');
  const {Journal}=await import('./journal.js');
  if (action === 'legacy') {
    assert(typeof Device.journalCloudDefault === 'undefined', 'Expected the pre-sync APK');
    await Journal.saveTrip({id:'historical', day:'2025-07-01', waterName:'Old private water', created:1});
    assert(await Journal.trip('historical'), 'Local-only APK did not retain the trip');
    return;
  }
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
    assert(el('#angler-age').readOnly && el('#angler-age').value==='48', 'Registration age is read-only'); el('#permit-expiry').value=expiry;
    el('#permit-expiry').dispatchEvent(new Event('input',{bubbles:true}));
    el('#permit-lead').value=lead; el('#permit-lead').dispatchEvent(new Event('change',{bubbles:true}));
    await click('#details-form button[type=submit]');
    await until(()=>el('#private-summary')?.textContent.includes('48'),'saved private details');
    const saved=await rpc('my_details');
    assert(saved.expiry===expiry && saved.reminder===lead,'Licence does not match the saved form');
  }
  if (!el('#journal-sync')) await openJournal();
  if (action==='ready') { await state('done'); return; }
  if (action.startsWith('crash-')) {
    const subject = Device.subjectId();
    const id = action.includes('before') ? 'crash-before-send' : 'crash-after-commit';
    const key = 'trip/' + id;
    const trip = {id, day:'2026-11-24', waterName:'Test Brook', created:Date.now(), notes:'First version'};
    const epoch = (await rpc('journal_sync',{op:'settings',args:{}})).epoch || '';
    if (action.startsWith('crash-recover-')) {
      const decision = await until(() => {
        const value = el('#journal-sync').dataset.state;
        return ['done','disabled'].includes(value) && value;
      }, 'post-crash sync decision');
      if (decision === 'disabled') {
        // WebView can lose a recent localStorage opt-in while retaining committed IndexedDB.
        assert((await Journal.syncHistory([subject,epoch,key]))?.pending.length === 1,
          'Losing device consent also lost the unacknowledged save');
        await confirm('enable');
      }
    }
    await state('done');
    const rows = async () => (await rpc('journal_sync',{op:'list', args:{format:2, epoch:epoch || null}})).rows;
    const receipt = () => Journal.syncHistory([subject,epoch,key]);
    if (action === 'crash-before-send') {
      const write = Journal.writeSyncHistory;
      let waiting = false;
      Journal.writeSyncHistory = async (address, value) => {
        await write(address, value);
        if (address[2] === key && value.pending.length) {
          waiting = true;
          await new Promise(() => {});
        }
      };
      await Journal.saveTrip(trip);
      await until(() => waiting, 'committed receipt before native save');
      assert((await receipt()).pending.length === 1 && !(await rows()).some(row => row.key === key),
        'Before-send cut did not precede the remote save');
      return;
    }
    if (action === 'crash-after-commit') {
      const reply = window.profileReply;
      let dropped = false;
      window.profileReply = (requestId,status,result) => {
        if (!dropped && status === 200 && typeof result?.revision === 'number' && Object.keys(result).length === 1) {
          dropped = true;
          return;
        }
        reply(requestId,status,result);
      };
      await Journal.saveTrip(trip);
      await until(() => dropped, 'committed save with undelivered reply');
      const sent = (await receipt()).pending[0].parts;
      assert((await rows()).some(row => row.key === key && JSON.stringify(row.parts) === JSON.stringify(sent)),
        'After-commit cut did not reach the server');
      await Journal.saveTrip({...trip, notes:'Edited before force-stop'});
      return;
    }
    const record = (await rows()).find(row => row.key === key), history = await receipt();
    const before = action === 'crash-recover-before';
    assert((await Journal.trip(id))?.notes === (before ? 'First version' : 'Edited before force-stop'),
      'Force-stop recovery lost the local trip edit');
    assert(record?.revision === (before ? 1 : 2) && history.pending.length === 0 &&
      JSON.stringify(record.parts) === JSON.stringify(history.base), 'Recovery left a conflict or replayed a save');
    return;
  }
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
    const rows=(await rpc('journal_sync',{op:'list',args:{format:2}})).rows.filter(r=>r.key==='trip/'+id);
    assert(rows.length===1 && rows[0].revision===1,'Duplicate or missing upload');
    await confirm('pause'); await state('disabled');
    await saveLicence(dateAfter(3),'week');
    await until(()=>Device.licenseMessage(),'due licence reminder');
    return {part:rows[0].parts[0],expiry:dateAfter(3)};
  }
  if (action==='isolation') {
    const rows=(await rpc('journal_sync',{op:'list',args:{format:2}})).rows;
    assert(!rows.some(r=>r.key==='trip/'+id) && !(await Journal.trip(id)),'Other user saw the trip');
    // A transport failure cannot demonstrate account isolation. Compare the real foreign hash
    // to an absent control and require the live manifest API to report both as missing.
    const absent = '0'.repeat(64);
    const hashes = [fixture.part, absent];
    const missing = await rpc('journal_sync', {op:'missing', args:{hashes}});
    assert(JSON.stringify([...missing.hashes].sort()) === JSON.stringify([...hashes].sort()), 'Foreign chunk was discoverable');
    async function missingStatus(hash) {
      try { await rpc('journal_sync', {op:'get', args:{hash}}); return 200; }
      catch (error) { return error.status; }
    }
    const [foreignStatus, controlStatus] = await Promise.all(hashes.map(missingStatus));
    assert(controlStatus === 404 && foreignStatus === controlStatus,
      'Foreign or absent chunk returned an unexpected status: '+foreignStatus+'/'+controlStatus);
    assert(!(await rpc('my_details')).expiry,'Other user accessed the private licence');
    assert(!rows.some(row => row.key === 'trip/historical') && !await Journal.trip('historical'),
      'Other account could read the upgraded journal');
    return;
  }
  if (action==='consent') {
    const historicalRows = async () => (await rpc('journal_sync', {op:'list', args:{format:2}}))
      .rows.filter(row => row.key === 'trip/historical');
    assert((await rpc('journal_sync', {op:'settings', args:{}})).enabled, 'Owner account must already sync');
    assert((await Journal.trip('historical'))?.waterName === 'Old private water', 'Upgrade lost the local trip');
    const settled = await until(() => {
      const value = el('#journal-sync').dataset.state;
      return ['disabled', 'done'].includes(value) && value;
    }, 'upgrade sync decision');
    const initial = await historicalRows();
    assert(settled === 'disabled' && initial.length === 0,
      'Upgraded journal before consent: state=' + settled + ', server rows=' + initial.length);
    await click(button('enable')); await click('#confirmation[open] #confirmation-cancel');
    window.dispatchEvent(new Event('online'));
    await state('disabled');
    assert((await historicalRows()).length === 0, 'Cancel uploaded a private trip');
    await confirm('enable'); await state('done');
    const uploaded = await historicalRows();
    assert(uploaded.length === 1 && uploaded[0].revision === 1, 'Accepted trip was not uploaded exactly once');
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
  await waitForJournal();
  const fixture=stage==='seed'?{}:JSON.parse(await readFile(fixtureFile,'utf8'));
  async function step(action) {
    const family = action.split('-')[0];
    const scenario = ({market:communityOnPhone, card:communityOnPhone, water:waterOnPhone, proof:evidenceOnPhone})[family] || onPhone;
    const expression='('+scenario.toString()+')('+JSON.stringify(action)+','+JSON.stringify(fixture)+',('+webviewControls.toString()+')())';
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
  if (stage==='seed' || stage==='renew' || /^(market|card|water|proof)-/.test(stage)) await writeFile(fixtureFile,JSON.stringify(fixture),{mode:0o600});
} finally {
  if (disconnected) adb('reverse','tcp:58443','tcp:58443');
  socket.close(); adb('forward','--remove','tcp:'+port);
}
