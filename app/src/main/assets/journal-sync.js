import { Journal } from './journal.js';
import { documentKeys, encodeDocument, uploadDocument, downloadDocument, restoreDocument } from './journal-transfer.js';
import { rpc } from './profile-api.js';
import { t, confirmAction } from './ui.js';

const subject=window.Device?.subjectId?.();
const prefix='journal.sync.v1.'+subject+'.';
const call=(op,args)=>rpc('journal_sync',{op,args});
const same=(a,b)=>a.length===b.length && a.every((v,i)=>v===b[i]);
let status='disabled', timer, busy=false, again=false, conflicts=[];
function notify(value) {
  status=value;
  window.dispatchEvent(new Event('journal-sync-status'));
}
function enabled() { return !!subject && localStorage.getItem(prefix+'enabled')==='1'; }
function schedule() {
  if (!enabled()) return;
  if (busy) { again=true; return; }
  clearTimeout(timer);
  notify('waiting');
  timer=setTimeout(()=>run(),700);
}
async function run(resolution) {
  if (busy || !enabled()) return;
  clearTimeout(timer);
  busy=true; conflicts=[]; notify('working');
  let changed=false;
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
        localStorage.setItem(checkpoint,JSON.stringify(local.hashes));
      } else if (same(base,local.hashes) || choice==='cloud') {
        const data=await downloadDocument(call,row.parts);
        await Journal.lock(async()=>{
          const latest=await encodeDocument(Journal,localStorage,subject,key);
          if (!same(local.hashes,latest.hashes)) { again=true; return; }
          await restoreDocument(Journal,localStorage,subject,key,data);
          localStorage.setItem(checkpoint,JSON.stringify(row.parts)); changed=true;
        });
      } else conflicts.push({key,revision:row.revision,local:local.hashes});
    }
    notify(conflicts.length?'conflict':'done');
    if (changed) window.dispatchEvent(new Event('journal-restored'));
  } catch (error) { notify(error.status===413?'full':'waiting'); }
  finally { busy=false; if (again) { again=false; schedule(); } }
}
export function bindJournalSync(panel) {
  if (!panel || !subject) return;
  function render() {
    if (!panel.isConnected) { window.removeEventListener('journal-sync-status',render); return; }
    panel.replaceChildren();
    const label=document.createElement('p');
    label.setAttribute('role','status'); label.textContent=t('sync.'+status); panel.append(label);
    const button=(labelKey,action)=>{
      const el=document.createElement('button'); el.type='button';el.className='secondary';
      el.textContent=t(labelKey);el.onclick=action;panel.append(el);
    };
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
    for (const c of conflicts) {
      const name=document.createElement('p');name.textContent=c.key;panel.append(name);
      for (const choice of ['cloud','local']) button('sync.'+choice,async()=>{
        if (await confirmAction({title:t('sync.'+choice),message:t('sync.replace'),accept:t('sync.'+choice),destructive:true}))
          run({...c,choice});
      });
    }
  }
  window.addEventListener('journal-sync-status',render); render();
}
window.addEventListener('journal-edited',schedule);
window.addEventListener('online',schedule);
document.addEventListener('visibilitychange',()=>{ if (!document.hidden) schedule(); });
async function start() {
  if (!subject || localStorage.getItem(prefix+'enabled')==='0') return;
  if (!enabled()) {
    if (!window.Device?.journalCloudDefault?.()) {
      // Previously local records need an explicit migration decision, even on a second handset.
      try {
        if (!(await call('settings',{})).enabled) return;
        const keys=await documentKeys(Journal,localStorage,subject);
        if (keys.some(key=>key.startsWith('trip/') || key.startsWith('photo/') || key.startsWith('pref/water/'))) return;
      } catch { return; }
    }
    if (localStorage.getItem(prefix+'enabled')===null) localStorage.setItem(prefix+'enabled','1');
  }
  schedule();
}
window.addEventListener('online',start);
start();
setInterval(()=>{ if (enabled() && !document.hidden && !busy && !conflicts.length) run(); },60000);
