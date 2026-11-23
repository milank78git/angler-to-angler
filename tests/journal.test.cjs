const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const source=readFileSync(require.resolve('../app/src/main/assets/journal.js'),'utf8');

test('offline trips, catches and photos are atomic, retryable and readable after reopening',async()=>{
  const indexedDB=new IDBFactory();
  const open=async()=>{
    const j=vm.runInNewContext(source+'\nJournal',{indexedDB,IDBKeyRange});
    await j.open();return j;
  };
  let j=await open();
  await j.saveTrip({id:'empty',day:'2026-11-23'});
  await j.saveTrip({id:'river',day:'2026-11-22'});
  const record={id:'fish-a',tripId:'river',lengthMm:723,position:{lat:49.01,lon:14.02,source:'manual'}};
  const photo=new Blob(['pixels'],{type:'image/jpeg'});
  await Promise.all([j.saveCatch(record,photo),j.saveCatch({id:'fish-b',tripId:'river'},null)]);
  await j.saveCatch(record,photo);
  j=await open();
  assert.equal((await j.trips()).length,2);
  assert.equal((await j.catches('empty')).length,0);
  assert.equal((await j.catches('river')).length,2);
  assert.equal((await j.catches('river'))[0].position.lon,14.02);
  assert.equal(await (await j.photo('fish-a')).text(),'pixels');
  await assert.rejects(()=>j.saveCatch({id:'orphan',tripId:'missing'},photo));
  assert.equal(await j.photo('orphan'),undefined);
  await j.removeTrip('river');assert.equal(await j.photo('fish-a'),undefined);
  assert.equal((await j.catches('river')).length,0);assert.equal((await j.trips()).length,1);
});
