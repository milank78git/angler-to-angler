const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const { JSDOM } = require('jsdom');
const { createJournal } = require('../app/src/main/assets/journal.js');
const { journalHistory, observeRevision, saveWithReceipt } = require('../app/src/main/assets/journal-history.js');

test('receipt commits precede save, rejected retries preserve earlier uncertainty', async () => {
  const empty = {base:null, pending:[], held:false};
  let state = empty;
  const save = async (part, status) => {
    const args = {parts:[part],revision:0,floor:12};
    const send = async () => {
      assert.ok(state.pending.some(p => p.parts[0] === part));
      throw Object.assign(Error('save'), {status});
    };
    await assert.rejects(saveWithReceipt(send,args,state,async next => {state = next;}), /save/);
  };
  await save('A', 503);
  for (const status of [401,403,409,413,422,429]) {
    await save('B', status);
    assert.deepEqual(state.pending.map(p => p.parts), [['A']]);
  }
  await save('B',504);
  await save('B',422);
  await save('C',408);
  await save('D',undefined);
  assert.deepEqual(state.pending.map(p => p.parts), [['A'],['B'],['C'],['D']]);
  for (const part of ['A','B','C','D']) {
    const result = await observeRevision(state,{revision:13,parts:[part]},12);
    assert.deepEqual(result.state, {base:[part], pending:[], held:false});
  }
  const absent = await observeRevision(state,{revision:0,parts:[]},12);
  assert.equal(absent.inFlight.length,4);
  let called = false;
  await assert.rejects(saveWithReceipt(() => {called=true;}, {parts:['E'],revision:0,floor:12},
    state,async () => {throw Error('quota');}), /quota/);
  assert.equal(called,false);
});

test('v2 data and legacy history survive interrupted migration, reopening and independent storage loss', async () => {
  const factory = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  const dbName = 'pre-sync-upgrade';
  await new Promise((resolve, reject) => {
    const req = factory.open(dbName,2);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('trips',{keyPath:'id'}).put({id:'river'});
      req.result.createObjectStore('catches',{keyPath:'id'}).createIndex('tripId','tripId');
      req.result.createObjectStore('photos').put(new Blob(['water']),['water','brook']);
      req.result.createObjectStore('fingerprints');
    };
    req.onsuccess = () => {req.result.close(); resolve();};
    req.onerror = () => reject(req.error);
  });
  const {window} = new JSDOM('',{url:'https://journal.test'});
  const storage = window.localStorage, prefix = 'journal.sync.v1.owner.';
  const db = createJournal(factory,dbName);
  const history = journalHistory(db,storage,'owner','epoch1');
  await db.saveTrip({id:'uncertain'});
  storage.setItem(prefix+'deletionFloor','9');
  storage.setItem(prefix+'base.trip/river','["trip"]');
  storage.setItem(prefix+'deviceOnly.trip/river','1');
  storage.setItem(prefix+'base.photo/brook','["photo"]');
  storage.setItem(prefix+'base.pref/ui.theme','["pref"]');
  await history.migrate();
  // Replay a leftover source key following a process stop just after commit.
  storage.setItem(prefix+'base.trip/river','["stale"]');
  await history.migrate();
  assert.equal(storage.getItem(prefix+'base.trip/river'),null);
  assert.deepEqual(await history.keys(),['photo/brook','trip/river','trip/uncertain','pref/ui.theme']);
  assert.deepEqual(await db.syncHistoryKeys('owner','epoch1'),[['owner','epoch1','photo/brook'],['owner','epoch1','trip/river'],['owner','epoch1','trip/uncertain']]);
  assert.equal((await history.get('trip/uncertain')).legacyFloor,9);
  assert.equal(storage.getItem(prefix+'deletionFloor'),null);
  assert.deepEqual((await history.get('pref/ui.theme')).base,['pref']);
  storage.clear();
  const reopened = createJournal(factory,dbName), again = journalHistory(reopened,storage,'owner','epoch1');
  assert.deepEqual(await again.get('trip/river'),{base:['trip'],pending:[],held:true});
  assert.deepEqual((await again.get('photo/brook')).base,['photo']);
  assert.equal(await again.get('pref/ui.theme'),null);
  await reopened.clearSyncHistory('owner','epoch1');
  assert.deepEqual((await again.get('trip/river')).base,['trip']);
  assert.equal(await journalHistory(reopened,storage,'owner','epoch2').get('trip/river'),undefined);
  await reopened.clearSyncHistory('owner');
  assert.deepEqual(await again.keys(),[]);
  assert.equal((await reopened.trip('river')).id,'river');
  assert.equal(await (await reopened.waterPhoto('brook')).text(),'water');
  window.close();
});
