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

test('unchanged trip and water photos use committed fingerprints across database connections', async () => {
  const {localDocument} = await import('../app/src/main/assets/journal-transfer.js');
  const factory = new IDBFactory();
  const db = createJournal(factory), writer = createJournal(factory);
  // Exercise the upgrade from a v1 installation containing an existing trip and catch photo.
  await new Promise((resolve, reject) => {
    const request = factory.open('angler-field-journal', 1);
    request.onupgradeneeded = () => {
      const trips = request.result.createObjectStore('trips', {keyPath:'id'});
      const catches = request.result.createObjectStore('catches', {keyPath:'id'});
      catches.createIndex('tripId','tripId');
      trips.put({id:'a'});
      catches.put({id:'f',tripId:'a',hasPhoto:true});
      request.result.createObjectStore('photos').put(new Blob(['old']), 'f');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  let reads = 0;
  const counted = {...db, photo: id => { reads++; return db.photo(id); },
    waterPhoto: id => { reads++; return db.waterPhoto(id); }};
  const inspect = (key, bytes) => localDocument(counted, null, '', key, bytes);
  const first = await inspect('trip/a');
  await writer.setWaterPhoto('lake', new Blob(['shore']));
  const lake = await inspect('photo/lake');
  assert.equal(reads, 2);
  for (let poll=0; poll<3; poll++) {
    assert.deepEqual((await inspect('trip/a')).hashes, first.hashes);
    assert.deepEqual((await inspect('photo/lake')).hashes, lake.hashes);
  }
  assert.equal(reads, 2);
  await writer.saveCatch({id:'f',tripId:'a'},new Blob(['new']));
  const changed = await inspect('trip/a');
  assert.notDeepEqual(changed.hashes, first.hashes);
  assert.equal(reads, 3);
  const version = (await db.fingerprint('trip/a')).version;
  await writer.removeTrip('a');
  await db.cacheHashes('trip/a', version, changed.hashes);
  assert.deepEqual((await inspect('trip/a')).hashes, []);
  await writer.writeWaterPhoto('lake', null);
  assert.deepEqual((await inspect('photo/lake')).hashes, []);
  await writer.restoreTrip('a', {trip:{id:'a'},catches:[]});
  const restored = await inspect('trip/a');
  assert.deepEqual((await inspect('trip/a', true)).hashes, restored.hashes);
});
