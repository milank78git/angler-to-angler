const test=require('node:test'), assert=require('node:assert/strict');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const {createJournal}=require('../app/src/main/assets/journal.js');
const {documentKeys,encodeDocument,uploadDocument,downloadDocument,restoreDocument}=require('../app/src/main/assets/journal-transfer.js');
test('an existing offline trip, exact coordinates, private photos and bookmarks restore on another account device',async()=>{
  global.IDBKeyRange=IDBKeyRange;
  const first=createJournal(new IDBFactory()),second=createJournal(new IDBFactory()), subject='my-account';
  const storage=()=>{const m=new Map();return {get length(){return m.size;},key:n=>[...m.keys()][n],
    getItem:k=>m.get(k)??null,removeItem:k=>m.delete(k),setItem:(k,v)=>m.set(k,v)};};
  const source=storage(),target=storage();
  source.setItem('water.my-account.cz.river','1'); source.setItem('water.other.cz.pond','1');
  const photo=new Blob([new Uint8Array(140000)],{type:'image/jpeg'});
  await first.saveTrip({id:'river',day:'2026-01-01',notes:'Private'});
  await first.saveCatch({id:'fish',tripId:'river',position:{lat:48,lon:14}},photo);
  await first.setWaterPhoto('pond',photo);
  const chunks=new Map(), manifest=new Map();
  const call=async(op,a)=>{
    if (op==='missing') return {hashes:a.hashes.filter(h=>!chunks.has(h))};
    if (op==='put') chunks.set(a.hash,a.data);
    if (op==='get') return {data:chunks.get(a.hash)};
    if (op==='save') { manifest.set(a.key,a.parts);return {revision:1}; }
    return {};
  };
  const keys=await documentKeys(first,source,subject);assert.equal(keys.length,3);
  for(const key of keys) {
    const data=await encodeDocument(first,source,subject,key);
    await uploadDocument(call,key,data,0);
    await restoreDocument(second,target,subject,key,await downloadDocument(call,manifest.get(key)));
  }
  assert.equal((await second.trip('river')).notes,'Private');assert.equal((await second.photo('fish')).size,140000);
  assert.deepEqual((await second.catchById('fish')).position,{lat:48,lon:14});
  assert.equal((await second.waterPhoto('pond')).size,140000);
  assert.equal(target.getItem('water.my-account.cz.river'),'1');assert.equal(target.length,1);
  await restoreDocument(second,target,subject,'trip/river',null);assert.equal(await second.photo('fish'),undefined);
});
