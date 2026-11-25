import { Journal } from './journal.js';
import { documentKeys, encodeDocument, uploadDocument, downloadDocument, restoreDocument } from './journal-transfer.js';
import { rpc } from './profile-api.js';
import { t, confirmAction, displayDay } from './ui.js';
import { languageTag } from './i18n.js';

const subject=window.Device?.subjectId?.();
const prefix='journal.sync.v1.'+subject+'.';
const call=(op,args)=>rpc('journal_sync',{op,args});
const same=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
let status = enabled() ? 'waiting' : 'disabled';
let timer, busy = false, again = false, conflicts = [];
const lastSyncKey = prefix + 'lastSuccess';
function online() { return navigator.onLine !== false; }
function notify(value) {
  status=value;
  window.dispatchEvent(new Event('journal-sync-status'));
}
function enabled() { return !!subject && localStorage.getItem(prefix+'enabled')==='1'; }
function schedule() {
  if (!enabled()) return;
  clearTimeout(timer);
  if (!online()) { notify('offline'); return; }
  if (busy) { again=true; return; }
  notify('waiting');
  timer=setTimeout(()=>run(),700);
}
async function run(resolution, retryRevision = true) {
  if (busy || !enabled()) return;
  clearTimeout(timer);
  if (!online()) { notify('offline'); return; }
  busy=true;
  const detected = [];
  notify('working');
  let changed=false, uploaded=false, reread=false;
  try {
    if (localStorage.getItem(prefix+'registered')!=='1') {
      await call('enable',{});
      localStorage.setItem(prefix+'registered','1');
    }
    const remote=new Map();
    let after='';
    while (true) {
      const {rows}=await call('list',{after});
      if (!rows.length) break;
      for (const row of rows) remote.set(row.key,row);
      after=rows.at(-1).key;
    }
    const keys=new Set([...await documentKeys(Journal,localStorage,subject),...remote.keys()]);
    for (const key of keys) {
      if (!enabled()) return;
      const row=remote.get(key)||{revision:0,parts:[]};
      const checkpoint=prefix+'base.'+key;
      const saved=localStorage.getItem(checkpoint);
      const base=JSON.parse(saved||'[]');
      const local=await Journal.lock(()=>encodeDocument(Journal,localStorage,subject,key));
      if (same(local.hashes,row.parts)) {
        if (!same(base,row.parts)) localStorage.setItem(checkpoint,JSON.stringify(row.parts));
        continue;
      }
      const choice=resolution?.key===key && resolution.revision===row.revision &&
        same(resolution.local,local.hashes) ? resolution.choice : '';
      const unknownDeletion=saved===null && row.revision>0 && !row.parts.length;
      if ((!unknownDeletion && same(base,row.parts)) || choice==='local') {
        await uploadDocument(call,key,local,row.revision);
        uploaded=true;
        localStorage.setItem(checkpoint,JSON.stringify(local.hashes));
      } else if (same(base,local.hashes) || choice==='cloud') {
        const data=await downloadDocument(call,row.parts);
        await Journal.lock(async()=>{
          if (!enabled()) return;
          const latest=await encodeDocument(Journal,localStorage,subject,key);
          if (!same(local.hashes,latest.hashes)) { again=true; return; }
          await restoreDocument(Journal,localStorage,subject,key,data);
          localStorage.setItem(checkpoint,JSON.stringify(row.parts)); changed=true;
        });
      } else {
        // A locally deleted trip can still be identified from its verified account copy.
        let trip;
        if (key.startsWith('trip/')) {
          trip = await Journal.trip(key.slice(5));
          if (!trip && row.parts.length) trip = (await downloadDocument(call,row.parts))?.trip;
        }
        detected.push({key, revision:row.revision, local:local.hashes, trip});
      }
    }
    if (!enabled()) return;
    conflicts = detected;
    if (conflicts.length) notify('conflict');
    else if (!online()) notify('offline');
    else if (!again) {
      if (uploaded || changed || !localStorage.getItem(lastSyncKey))
        localStorage.setItem(lastSyncKey, String(Date.now()));
      notify('done');
    }
  } catch (error) {
    if (enabled()) {
      if (!online()) notify('offline');
      else if (error.status === 409 && retryRevision) reread = true;
      else if (error.status === 413) notify('full');
      else if (error.status === 401 || error.status === 403) notify('signin');
      else notify('failed');
    }
  } finally {
    busy = false;
    if (changed) window.dispatchEvent(new Event('journal-restored'));
    if (again) { again=false; schedule(); }
    else if (reread) await run(undefined, false);
  }
}
/** Prefer the fishing date and water over an internal record identifier. */
function conflictLabel(conflict, waters) {
  const { key, trip } = conflict;
  if (key.startsWith('trip/')) {
    const fields = [];
    if (trip?.day && Number.isFinite(Date.parse(trip.day+'T12:00:00Z'))) fields.push(displayDay(trip.day));
    if (trip?.waterName) fields.push(trip.waterName);
    if (trip?.waterNumber) fields.push(trip.waterNumber);
    return fields.join(' · ') || t('sync.trip');
  }
  if (key.startsWith('photo/')) {
    const id = key.slice(6);
    return t('water_photo.personal')+' · '+(waters?.byKey.get(id)?.name || id);
  }
  if (key.startsWith('pref/water/')) {
    const id = key.slice(11);
    return t('waters.favorites')+' · '+(waters?.byId.get(id.slice(id.indexOf('.')+1))?.name || id);
  }
  if (key === 'pref/atlas.topographic') return t('atlas.topographic');
  if (key === 'pref/country' || key === 'pref/fish.country') return t('fish_catalogue.fishing_country');
  return t('settings.title');
}

export function bindJournalSync(panel, waters) {
  if (!panel || !subject) return;
  function render() {
    if (!panel.isConnected) { window.removeEventListener('journal-sync-status',render); return; }
    panel.replaceChildren();
    const label=document.createElement('p');
    label.setAttribute('role','status');
    panel.dataset.state = status;
    const last = Number(localStorage.getItem(lastSyncKey));
    const stamp = last > 0 && Number.isFinite(new Date(last).getTime())
      ? new Intl.DateTimeFormat(languageTag,{dateStyle:'short',timeStyle:'short'}).format(last) : '';
    label.textContent = status === 'done' && stamp
      ? t('sync.saved_at').replace('{time}', stamp) : t('sync.'+status);
    panel.append(label);
    if (stamp && status !== 'done') {
      const previous = document.createElement('p');
      previous.className = 'meta';
      previous.textContent = t('sync.last_success').replace('{time}', stamp);
      panel.append(previous);
    }
    const button=(labelKey,action)=>{
      const el=document.createElement('button'); el.type='button';el.className='secondary';
      el.dataset.action=labelKey;el.textContent=t(labelKey);el.onclick=action;panel.append(el);
    };
    if (!enabled() && status === 'check_failed') button('sync.retry', start);
    if (!enabled()) button('sync.enable',async()=>{
      if (await confirmAction({title:t('sync.enable'),message:t('sync.consent'),accept:t('sync.enable')})) {
        localStorage.setItem(prefix+'enabled','1');schedule();
      }
    });
    else if (status!=='working') {
      button('sync.retry',()=>run());
      button('sync.pause',async()=>{
        if (await confirmAction({title:t('sync.pause'),message:t('sync.pause_info'),accept:t('sync.pause')})) {
          clearTimeout(timer);localStorage.setItem(prefix+'enabled','0');conflicts=[];notify('disabled');
        }
      });
    }
    if (status !== 'conflict') return;
    for (const c of conflicts) {
      const name=document.createElement('p'); name.textContent=conflictLabel(c, waters); panel.append(name);
      for (const choice of ['cloud','local']) button('sync.'+choice,async()=>{
        if (await confirmAction({title:t('sync.'+choice),message:t('sync.replace'),accept:t('sync.'+choice),destructive:true}))
          run({...c,choice});
      });
    }
  }
  window.addEventListener('journal-sync-status',render); render();
}
window.addEventListener('offline', () => { if (enabled()) { clearTimeout(timer); notify('offline'); } });
window.addEventListener('journal-edited',schedule);

function resume() {
  if (status === 'check_failed') start();
  else schedule();
}
document.addEventListener('visibilitychange',()=>{ if (!document.hidden) resume(); });
async function start() {
  if (!subject || localStorage.getItem(prefix+'enabled')==='0') return;
  if (!enabled()) {
    if (!window.Device?.journalCloudDefault?.()) {
      // Previously local records need an explicit migration decision, even on a second handset.
      try {
        if (!(await call('settings',{})).enabled) { if (!enabled()) notify('disabled'); return; }
        const keys=await documentKeys(Journal,localStorage,subject);
        if (keys.some(key=>key.startsWith('trip/') || key.startsWith('photo/') || key.startsWith('pref/water/'))) {
          if (!enabled()) notify('disabled');
          return;
        }
      } catch { if (!enabled() && localStorage.getItem(prefix+'enabled') === null) notify('check_failed'); return; }
    }
    if (localStorage.getItem(prefix+'enabled')===null) localStorage.setItem(prefix+'enabled','1');
  }
  schedule();
}
window.addEventListener('online',start);
start();
setInterval(() => {
  if (!online() || document.hidden || busy) return;
  if (status === 'check_failed') start();
  else if (enabled() && status !== 'conflict') run();
}, 60000);
