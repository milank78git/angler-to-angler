const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('a legacy trip and a pruned history do not stop other records; restoration yields to local edits', async t => {
  const { window } = new JSDOM('<aside></aside>', { url: 'https://example.test' });
  Object.assign(globalThis, { window, document: window.document, localStorage: window.localStorage,
    Event: window.Event, indexedDB: new IDBFactory(), IDBKeyRange });
  // Simulate the exclusive Web Lock used by the Android WebView, so a download
  // incorrectly performed inside the critical section prevents the user edit.
  let writer = Promise.resolve();
  const locks = {request(_name, work) {
    const next = writer.then(work);
    writer = next.catch(() => {});
    return next;
  }};
  Object.defineProperty(globalThis.navigator, 'locks', {configurable:true, value:locks});
  t.after(() => delete globalThis.navigator.locks);
  const prefix = 'journal.sync.v1.owner.';
  localStorage.setItem(prefix + 'enabled', '1');
  localStorage.setItem(prefix + 'registered', '1');
  const jpeg = Buffer.from('ffd8ff00', 'hex');
  const payload = Buffer.from(JSON.stringify({ version: 2, value: { trip: { id: 'restore', notes: 'cloud' },
    catches: [{ record: { id: 'fish', tripId: 'restore', hasPhoto: true }, photoHash: hash(jpeg) }] } }));
  const page = [
    { key: 'trip/deleted', revision: 3, parts: [], format: 2 },
    { key: 'trip/legacy', revision: 2, parts: ['old'], format: 1 },
    { key: 'trip/restore', revision: 1, parts: [hash(payload)], format: 2 },
  ];
  let photoReply;
  const writes = [], operations = [];
  window.Device = {
    subjectId: () => 'owner',
    profileRequest(id, operation, body) {
      const { op, args } = JSON.parse(body);
      operations.push(op);
      const reply = value => queueMicrotask(() => window.profileReply(id, 200, value));
      switch (op) {
        case 'list': return reply({ rows: args.after ? [] : page, floor: 17, photoFormat: 2, photoRevision: '1' });
        case 'photo_list': return reply({photos: [], revision: '1'});
        case 'get': return reply({data:payload.toString('base64')});
        case 'photo_get': photoReply = () => reply({data:jpeg.toString('base64'),size:jpeg.length}); return;
        case 'missing': return reply({hashes:args.hashes});
        case 'put': return reply({});
        case 'save': {
          writes.push(args);
          const prior = page.find(row => row.key === args.key);
          const next = {key: args.key, revision: (prior?.revision || 0) + 1, parts: args.parts, format: 2};
          if (prior) Object.assign(prior, next);
          else page.push(next);
          return reply({revision: next.revision});
        }
        default: throw Error('Unexpected RPC '+op);
      }
    },
  };
  const { Journal } = await import('../app/src/main/assets/journal.js');
  await Journal.saveTrip({ id: 'new', notes: 'first sync of old local journal' });
  await Journal.saveTrip({ id: 'deleted', notes: 'keep until explicitly resolved' });
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const { bindJournalSync } = await import('../app/src/main/assets/journal-sync.js');
  const panel = document.querySelector('aside');
  bindJournalSync(panel);
  t.mock.timers.tick(701);
  async function until(predicate) {
    for (let i=0; i<2000 && !predicate(); i++) await new Promise(resolve=>setImmediate(resolve));
    assert.ok(predicate());
  }
  await until(() => !!photoReply);
  let saved = false;
  const edit = Journal.saveTrip({id:'restore', notes:'saved while download was in flight'}).then(()=>{saved=true;});
  await until(() => saved);
  photoReply();
  await edit;
  await until(() => panel.dataset.state !== 'working');
  assert.equal((await Journal.trip('restore')).notes, 'saved while download was in flight');
  assert.equal(await Journal.photo('fish'), undefined);
  assert.equal((await Journal.trip('deleted')).notes, 'keep until explicitly resolved');
  assert.deepEqual(writes.map(w=>[w.key,w.floor]), [['trip/new',17]]);
  assert.equal(operations.includes('photo_convert'), false);
  // The tombstone keeps the phone copy, including on a second sync after pruning.
  page.splice(1, 2);
  page.splice(0, 1);
  t.mock.timers.tick(701);
  await until(() => panel.dataset.state === 'device_only' && panel.querySelector('[data-action="sync.upload_copy"]'));
  assert.equal(panel.querySelector('[data-action="sync.cloud"]'), null);
  assert.equal(panel.querySelector('[data-action="sync.local"]'), null);
  assert.equal(writes.some(w => w.key === 'trip/deleted'), false);
  assert.equal(localStorage.getItem(prefix + 'deviceOnly.trip/deleted'), '1');
  assert.equal((await Journal.trip('deleted')).notes, 'keep until explicitly resolved');
  panel.querySelector('[data-action="sync.upload_copy"]').click();
  await until(() => panel.dataset.state === 'done');
  assert.equal(writes.filter(w => w.key === 'trip/deleted').length, 1);
  assert.equal(localStorage.getItem(prefix + 'deviceOnly.trip/deleted'), null);

  // Both surviving versions have changed since the checkpoint: both choices belong here.
  const cloud = page.find(row => row.key === 'trip/deleted');
  cloud.parts = [hash(Buffer.from('divergent account contents'))];
  cloud.revision++;
  await Journal.saveTrip({id: 'deleted', notes: 'divergent phone contents'});
  panel.querySelector('[data-action="sync.retry"]').click();
  await until(() => panel.dataset.state === 'conflict' && panel.querySelector('[data-action="sync.cloud"]'));
  assert.ok(panel.querySelector('[data-action="sync.local"]'));
  assert.equal(panel.querySelector('[data-action="sync.upload_copy"]'), null);
  window.close();
});

test('a cloud-only catch uploads its metadata with an explicit missing-photo reference', async () => {
  const { uploadDocument } = await import('../app/src/main/assets/journal-transfer.js');
  const digest = 'a'.repeat(64), calls = [];
  const remote = async (op,args) => {
    calls.push(op);
    if (op==='photo_need') return {needed:args.id==='fish'};
    if (op==='missing') return {hashes:[]};
    assert.equal(op,'save');
    assert.deepEqual(args.unavailable,{'1':true});
    return {revision:3};
  };
  assert.equal(await uploadDocument(remote,'trip/day',{hashes:['manifest'],blocks:new Map(),
    photos:[{id:'available',hash:digest,file:null},{id:'fish',hash:digest,file:null}]},2,8),3);
  assert.deepEqual(calls,['photo_need','photo_need','missing','save']);
});

test('a prepared restore cannot discard a matching local original installed after download', async () => {
  const { createJournal } = await import('../app/src/main/assets/journal.js');
  const { localDocument, prepareRestore } = await import('../app/src/main/assets/journal-transfer.js');
  const db = createJournal(new IDBFactory());
  const bytes = Buffer.from('ffd8ff00','hex');
  const digest = hash(bytes), key = 'trip/late';
  const trip = {id:'late', notes:'original'};
  const record = {id:'fish', tripId:'late', hasPhoto:false, cloudPhotoHash:digest};
  await db.restoreTrip('late', {trip, catches:[{record,photo:null}]});
  const prior = await localDocument(db, null, 'owner', key, false, true);
  const apply = await prepareRestore(db, null, 'owner', key, {
    trip:{...trip,notes:'updated cloud notes'}, detached:true,
    catches:[{record:{id:'fish',tripId:'late',hasPhoto:true},photoHash:digest}],
  },async()=>({expired:true}));
  await db.installCloudPhoto(record,new Blob([bytes],{type:'image/jpeg'}));
  const latest = await localDocument(db, null, 'owner', key, false, true);
  assert.deepEqual(latest.hashes,prior.hashes);
  assert.equal(await apply(prior),false);
  assert.deepEqual(Buffer.from(await (await db.photo('fish')).arrayBuffer()),bytes);
  assert.equal((await db.trip('late')).notes,'original');
});
