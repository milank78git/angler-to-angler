const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {indexedDB} = require('fake-indexeddb');
const root = path.resolve(__dirname,'..');
const asset = name => JSON.parse(fs.readFileSync(path.join(root,'app/src/main/assets',name+'.json')));
global.document = {querySelector: () => null};
global.window = {};

test('the installation manifest runs every immutable SQL file exactly once and in order', () => {
  const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
  const xml=fs.readFileSync(path.join(root,'db/changelog.xml'),'utf8');
  const applied=[...xml.matchAll(/<sqlFile path="\.\.\/supabase\/migrations\/([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(applied,files);
  assert.ok(xml.indexOf('tagDatabase')>xml.indexOf('post_notifications.sql'));
  assert.ok(xml.indexOf('tagDatabase')<xml.indexOf('water_reviews_and_visit_statistics.sql'));
});

test('car destinations belong to catalogued waters and differ from fishing or foot access coordinates', async () => {
  const records=asset('parking'),pack=asset('catalog'), waters=asset('czech-waters').waters;
  const {waterPoint,clusterWaters}=await import('../app/src/main/assets/world-map.js');
  for(const [id,points] of Object.entries(records)){
    assert.ok(waters.some(w=>w.id===id));
    for(const p of points){
      assert.ok(/^https:\/\//.test(p.source) && /^\d{4}-\d{2}-\d{2}$/.test(p.checked));
      assert.deepEqual(waterPoint({points:[p.point]},{}),p.point);
    }
  }
  assert.notDeepEqual(records['CZ:401009'][0].point,pack.waters.find(w=>w.id==='401009').access.pt);
  assert.equal(waterPoint({},{}),undefined);
  assert.equal(waterPoint({points:[[190,100]]},{}),undefined);
  const watersHere=[{point:[3,4]},{point:[4,5]},{point:[79,11]},{point:[300,10]}];
  assert.deepEqual(clusterWaters(watersHere,p=>p,100,100).map(g=>g.waters.length),[2,1]);
});

test('local rankings use actual catches, count blank trips and update after trip deletion',async()=>{
  const {createJournal}=await import('../app/src/main/assets/journal.js');
  const {personalTotals}=await import('../app/src/main/assets/journal-statistics.js');
  const store=createJournal(indexedDB,'stat-regression');
  for(const [id,waterId] of [['a','1'],['b','1'],['c','2']])
    await store.saveTrip({id,country:'CZ',waterId,waterName:'Same name',day:'2026-11-24'});
  await store.saveCatch({id:'fish',tripId:'a',speciesId:'pike',speciesName:'Pike'});
  let data=await store.statEntries();
  let ranked=personalTotals(data.trips,data.catches,asset('catalog'),null);
  assert.deepEqual(ranked.waters.map(r=>r.count),[2,1]);assert.deepEqual(ranked.species,[{label:'Pike',count:1}]);
  await store.removeTrip('a');data=await store.statEntries();
  ranked=personalTotals(data.trips,data.catches,asset('catalog'),null);
  assert.deepEqual(ranked.species,[]);assert.deepEqual(ranked.waters.map(r=>r.count),[1,1]);
});

test('atlas markers and visible topographic tiles agree at Lipno, across zoom levels and at the poles', async () => {
  const {mercator,visibleTiles} = await import('../app/src/main/assets/atlas-basemap.js');
  assert.deepEqual(mercator([0,0]), [.5,.5]);
  const [x,y] = mercator([14.16,48.66]);
  assert.equal(Math.floor(x*8192),4418);
  assert.equal(Math.floor(y*8192),2825);
  for (const level of [13,13.25,13.75]) {
    const tiles=visibleTiles({x,y,level},360,480);
    const center=tiles.filter(t=>t.x<=180 && t.x+t.size>180 && t.y<=240 && t.y+t.size>240);
    const z=Math.round(level), n=2**z;
    assert.deepEqual(center.map(t=>t.key),[z+'/'+Math.floor(x*n)+'/'+Math.floor(y*n)]);
    assert.equal(new Set(tiles.map(t=>t.key)).size,tiles.length);
  }
  for (const lat of [90,-90]) {
    const [x,y]=mercator([180,lat]);
    assert.ok(y>=-1e-12 && y<=1+1e-12);
    assert.deepEqual(visibleTiles({x,y,level:0},360,480).map(t=>t.key),['0/0/0']);
  }
});
