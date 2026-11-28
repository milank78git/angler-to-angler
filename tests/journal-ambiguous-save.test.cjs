const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { JSDOM } = require('jsdom');

test('the journal reconciles older pending saves, pruning, re-added favorites and age erasure', async t => {
  const {window} = new JSDOM('<aside></aside>', {url:'https://journal.test'});
  Object.assign(globalThis,{window,document:window.document,localStorage:window.localStorage,
    Event:window.Event,indexedDB:new IDBFactory(),IDBKeyRange});
  const owner='owner', prefix='journal.sync.v1.owner.', epoch='original';
  localStorage.setItem(prefix+'enabled','1');
  localStorage.setItem(prefix+'registered','1');
  localStorage.setItem(prefix+'epoch',epoch);
  localStorage.setItem(prefix+'deletionFloor','0');
  const page=new Map(), saves=[];
  let failure=503, floor=0, erased=false;
  window.Device = {subjectId:()=>owner, profileRequest(id,_operation,body) {
    const {op,args} = JSON.parse(body);
    const reply=(status,result)=>queueMicrotask(()=>window.profileReply(id,status,result));
    if (op==='list') return erased ? reply(410,null) : reply(200,{rows:args.after?[]:[...page.values()],floor});
    if (op==='settings') return reply(200,{enabled:!erased,epoch});
    if (op==='missing') return reply(200,{hashes:[]});
    assert.equal(op,'save');
    saves.push(args);
    if (failure) return reply(failure,null);
    const revision=(args.revision || floor)+1;
    page.set(args.key,{key:args.key,parts:args.parts,revision});
    return reply(200,{revision});
  }};
  const {Journal} = await import('../app/src/main/assets/journal.js');
  const trip = 'river', key='trip/'+trip;
  const edit=notes=>Journal.saveTrip({id:trip,notes});
  const receipt=()=>Journal.syncHistory([owner,epoch,key]);
  await edit('A');
  await Journal.saveTrip({id:'unknown-before-upgrade',notes:'Older version never recorded an outcome'});
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const {bindJournalSync} = await import('../app/src/main/assets/journal-sync.js');
  const panel=document.querySelector('aside');
  bindJournalSync(panel);
  const retry=()=>panel.querySelector('[data-action="sync.retry"]').click();
  async function settled(expected) {
    for (let i=0;i<3000;i++) {
      if (panel.dataset.state === expected && panel.querySelector('button')) return;
      await new Promise(resolve=>setImmediate(resolve));
    }
    assert.fail('Expected '+expected+', got '+panel.dataset.state);
  }
  t.mock.timers.tick(701);
  await settled('failed');
  const A=saves.at(-1).parts;
  assert.deepEqual((await receipt()).pending.map(p=>p.parts),[A]);
  await edit('B');
  failure=504; retry(); await settled('failed');
  const B=saves.at(-1).parts;
  assert.deepEqual((await receipt()).pending.map(p=>p.parts),[A,B]);
  await edit('C');
  // The server committed A. Both replies were lost and C is still only on the phone.
  page.set(key,{key,revision:1,parts:A});
  floor=2;
  failure=0; retry(); await settled('device_only');
  assert.deepEqual((await receipt()).base,saves.at(-1).parts);
  assert.deepEqual((await receipt()).pending,[]);
  assert.equal(saves.at(-1).revision,1);
  assert.equal((await Journal.trip(trip)).notes,'C');

  const lake='trip/lake';
  await Journal.saveTrip({id:'lake',notes:'Uncertain on the server'});
  failure=503; retry(); await settled('failed');
  const count=saves.filter(s=>s.key===lake).length;
  floor=10;
  await Journal.saveTrip({id:'new',notes:'Created offline after pruning'});
  failure=0; retry(); await settled('device_only');
  assert.equal(saves.filter(s=>s.key===lake).length,count);
  assert.equal((await Journal.trip('lake')).notes,'Uncertain on the server');
  assert.ok(page.has('trip/new'));
  // Pre-upgrade records have no receipt to disambiguate a pruned save.
  assert.ok(!page.has('trip/unknown-before-upgrade'));
  assert.ok(await Journal.trip('unknown-before-upgrade'));

  const pref='pref/water/pack.river', favorite='water.owner.pack.river';
  localStorage.setItem(favorite,'1');
  retry(); await settled('device_only');
  assert.ok(page.has(pref));
  page.set(pref,{key:pref,revision:20,parts:[]});
  localStorage.removeItem(favorite);
  localStorage.setItem(prefix+'added.'+pref,'again');
  localStorage.setItem(favorite,'1');
  retry(); await settled('device_only');
  assert.equal(saves.at(-1).key,pref);
  assert.equal(saves.at(-1).revision,20);
  assert.equal(localStorage.getItem(prefix+'added.'+pref),null);
  assert.ok(localStorage.getItem(prefix+'state.'+pref));

  await Journal.setWaterPhoto('brook',new Blob(['shore']));
  retry(); await settled('device_only');
  erased=true;
  retry(); await settled('disabled');
  assert.equal(localStorage.getItem(prefix+'enabled'),'0');
  assert.equal(localStorage.getItem(prefix+'state.'+pref),null);
  assert.deepEqual(await Journal.syncHistoryKeys(owner,epoch),[]);
  assert.equal((await Journal.trip(trip)).notes,'C');
  assert.equal(await (await Journal.waterPhoto('brook')).text(),'shore');
  assert.equal(localStorage.getItem(favorite),'1');
  window.close();
});
