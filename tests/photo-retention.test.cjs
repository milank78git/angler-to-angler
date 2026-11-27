const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const {createJournal}=require('../app/src/main/assets/journal.js');
const {photoHash,restorePhoto,stagePhoto}=require('../app/src/main/assets/journal-photos.js');
const {encodeDocument,uploadDocument,downloadDocument,restoreDocument}=require('../app/src/main/assets/journal-transfer.js');

test('two devices retain catch notes and independent local JPEGs across expiry, edits and re-upload',async()=>{
  global.IDBKeyRange=IDBKeyRange;
  const first=createJournal(new IDBFactory()),second=createJournal(new IDBFactory()),fresh=createJournal(new IDBFactory());
  const bytes=Buffer.alloc(155000,84);bytes[0]=255;bytes[1]=216;bytes[2]=255;
  const photo=new Blob([bytes],{type:'image/jpeg'}),hash=await photoHash(photo);
  const chunks=new Map(),stage=new Map();let active=false,tombstone=false,uploads=0,parts,reads=0;
  const call=async(op,args)=>{
    switch(op){
      case 'photo_need':return {needed:!active&&!tombstone};
      case 'photo_part':stage.set(args.part,Buffer.from(args.data,'base64'));return {};
      case 'photo_prepare':case 'photo_reupload':
        assert.deepEqual(Buffer.concat([...stage.values()]),bytes);uploads++;active=true;tombstone=false;stage.clear();return {};
      case 'photo_get':reads++;return active ? {size:bytes.length,data:bytes.subarray(args.offset,args.offset+65536).toString('base64')} : {expired:true};
      case 'missing':return {hashes:args.hashes.filter(h=>!chunks.has(h))};
      case 'put':chunks.set(args.hash,args.data);return {};
      case 'get':return {data:chunks.get(args.hash)};
      case 'save':assert.equal(args.format,2);parts=args.parts;return {revision:1};
      default:throw Error('Unexpected operation: '+op);
    }
  };
  const key='trip/river',snapshot=async db=>encodeDocument(db,null,'angler',key,true);
  const restore=async db=>restoreDocument(db,null,'angler',key,await downloadDocument(call,parts),call);
  await first.saveTrip({id:'river',notes:'First trip'});await first.saveCatch({id:'fish',tripId:'river',lengthMm:753},photo);
  await uploadDocument(call,key,await snapshot(first),0);
  assert.ok(Buffer.from(chunks.get(parts[0]),'base64').length<500);
  await restore(second); assert.equal(await photoHash(await second.photo('fish')),hash);assert.equal(reads,3);
  tombstone=true;active=false;
  await second.saveTrip({id:'river',notes:'Ruler checked'});
  await uploadDocument(call,key,await snapshot(second),1);
  await restore(first);await restore(fresh);
  assert.equal(uploads,1);assert.equal(await photoHash(await first.photo('fish')),hash);
  assert.equal(await fresh.photo('fish'),undefined);assert.equal((await fresh.catchById('fish')).lengthMm,753);
  assert.equal((await fresh.trip('river')).notes,'Ruler checked');
  assert.deepEqual((await snapshot(fresh)).hashes,(await snapshot(first)).hashes);
  await stagePhoto(call,{trip:key,id:'fish',hash,cycle:'expired'},photo,'photo_reupload');
  await fresh.installCloudPhoto(await fresh.catchById('fish'),await restorePhoto(call,{trip:key,id:'fish',hash},null));
  assert.equal(await photoHash(await fresh.photo('fish')),hash);
  assert.deepEqual((await snapshot(fresh)).hashes,parts);
});
test('a damaged transfer cannot overwrite a local trip and an expiry between blocks returns no partial JPEG',async()=>{
  let count=0;
  const call=async()=>++count===1 ? {size:70000,data:Buffer.alloc(65536).toString('base64')} : {expired:true};
  assert.equal(await restorePhoto(call,{hash:'bad'},null),null);
  await assert.rejects(()=>restorePhoto(async()=>({size:2,data:'AAA='}),{hash:'wrong'},null),/digest/);
  await assert.rejects(()=>restorePhoto(async()=>({size:80000,data:'AAA='}),{hash:'wrong'},null),/part/);
});
