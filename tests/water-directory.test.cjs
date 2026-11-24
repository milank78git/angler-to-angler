const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assets = join(__dirname, '../app/src/main/assets');
const json = name => JSON.parse(readFileSync(join(assets, name)));
const snapshot = json('czech-waters.json');
const shapes = json('czech-water-shapes.json');

test('source identities survive duplicate numbers, and all app keys have database targets', async () => {
  const { createWaterDirectory } = await import('../app/src/main/assets/water-directory.js');
  const directory = createWaterDirectory(json('catalog.json'), snapshot);
  assert.equal(directory.byKey.size, directory.waters.length);
  assert.equal(directory.byId.size, directory.waters.length);
  assert.equal(directory.byId.get('401009').key, 'CZ:401009');
  assert.equal(directory.byKey.get('CZ:401001').name, 'Berounka 1');
  const duplicates = snapshot.waters.filter(w => w.number === '4510091');
  assert.equal(new Set(duplicates.map(w => w.id)).size, 2);
  assert.equal(directory.byKey.get('CZ:MRS:1').source, 'https://mrsbrno.cz/reviry/1');
  const migration = readFileSync(join(__dirname, '../supabase/migrations/20261124050000_czech_waters.sql'), 'utf8');
  const keys = [...migration.matchAll(/^\('(CZ:[^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(keys.sort(), snapshot.waters.map(w => w.id).filter(id => /^CZ:(MRS|CRS):/.test(id)).sort());
  assert.deepEqual(Object.keys(shapes).sort(), snapshot.waters.filter(w => w.mapped).map(w => w.id).sort());
});

test('nearby searches handle islands, holes, multiple published points and unknown locations', async () => {
  const { waterDistances } = await import('../app/src/main/assets/water-directory.js');
  const square = (x, y, size) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
  const shapes = { mapped: [[square(14, 49, 1), square(14.4,49.4,0.2)], [square(16,49,0.1)]] };
  const waters = [{id:'mapped', key:'mapped'}, {id:'points', points:[[13,50],[14.5,49.5]]}, {id:'unknown'}];
  const distance = (lon,lat) => waterDistances(waters, shapes, {lon,lat});
  assert.equal(distance(14.2,49.2).get('mapped'),0);
  assert.equal(distance(16.05,49.05).get('mapped'),0);
  assert.ok(distance(14.5,49.5).get('mapped') > 7);
  assert.equal(distance(14.5,49.5).get('points'),0);
  assert.ok(!distance(14.5,49.5).has('unknown'));
  assert.ok(distance(14,49.75).get('mapped') < 0.001);
});

test('the official Dyje 5 points and Prague pilot outlines are in WGS84 longitude/latitude order', async () => {
  const { createWaterDirectory, waterDistances } = await import('../app/src/main/assets/water-directory.js');
  const directory = createWaterDirectory(json('catalog.json'), snapshot);
  const dyje = directory.byKey.get('CZ:MRS:1');
  assert.ok(waterDistances([dyje], {}, {lon:16.72212,lat:48.85829}).get(dyje.id) < 0.001);
  const local = directory.byId.get('401001');
  assert.ok(waterDistances([local], shapes, {lon:14.36,lat:49.97}).get(local.id) < 2);
  for (const [key, polygons] of Object.entries(shapes)) {
    for (const rings of polygons) for (const ring of rings) {
      assert.deepEqual(ring[0], ring.at(-1), key);
      assert.ok(ring.every(([lon,lat]) => lon >= 12 && lon <= 19 && lat >= 48.5 && lat <= 51.1), key);
    }
  }
});

test('the European register keeps source scope, geometry and community targets aligned', async () => {
  const { createWaterDirectory, waterDistances } = await import('../app/src/main/assets/water-directory.js');
  const editions = json('europe-waters.json'), sources = json('water-sources.json');
  const countries = json('europe-rules.json').countries;
  const atlas = createWaterDirectory(json('catalog.json'), snapshot, editions, sources, countries, shapes);
  assert.equal(Object.keys(atlas.countries).length, 51);
  assert.equal(atlas.byId.size, atlas.byKey.size);
  assert.equal(atlas.byId.size, atlas.waters.length);
  const sql = readFileSync(join(__dirname,'../supabase/migrations/20261124060100_european_water_seed.sql'),'utf8');
  const keys = [...sql.matchAll(/^\('([A-Z]{2}:[^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(keys.sort(), atlas.waters.filter(w => w.publisher).map(w => w.key).sort());
  const selected = ['IFI','SRZ','FVO','ICNF','AGE','BERLIN','DAERA'].map(p => atlas.waters.find(w => w.provider === p));
  assert.ok(selected.every(w => w.asOf && w.source.startsWith('https://') && w.scope && countries[w.country]));
  const [irish, slovak, swedish, portuguese] = selected;
  assert.equal(irish.kind, 'access');
  assert.equal(swedish.kind, 'management');
  assert.ok(!waterDistances([slovak], {}, {lon:17,lat:49}).has(slovak.id));
  assert.equal(waterDistances([irish], {}, {lon:irish.points[0][0],lat:irish.points[0][1]}).get(irish.id),0);
  const [[a,b]] = portuguese.lines;
  assert.ok(waterDistances([portuguese], {}, {lon:(a[0]+b[0])/2,lat:(a[1]+b[1])/2}).get(portuguese.id)<0.001);
  const outlines = await atlas.geography();
  assert.ok(outlines[selected[5].key].length > 0);
});

test('trip identities and local rules follow the selected edition independently', async () => {
  const { createWaterDirectory, localRuleWater, matchesWater, tripWater } = await import('../app/src/main/assets/water-directory.js');
  const pack = json('catalog.json');
  const atlas = createWaterDirectory(pack, snapshot, json('europe-waters.json'), json('water-sources.json'));
  const pilot = tripWater(atlas, { country: 'CZ', waterId: '401009' });
  assert.equal(pilot.key, 'CZ:401009');
  assert.equal(localRuleWater(pack, pilot).id, pilot.id);
  for (const [country, waterId] of [['CZ','CZ:MRS:1'], ['IE','IE:IFI:1'], ['US','US-MT:39754243']]) {
    const water = tripWater(atlas, { country, waterId });
    assert.equal(water.key, waterId);
    assert.equal(localRuleWater(pack, water), undefined);
  }
  assert.ok(matchesWater(atlas.byKey.get('CZ:MRS:1'), '461024'));
  assert.ok(matchesWater(pilot, 'sazava'));
  assert.equal(tripWater(atlas, { country:'IE', waterId:'401009' }), undefined);
  assert.equal(tripWater(atlas, { country:null, waterId:null, waterName:pilot.name }), undefined);
  assert.equal(tripWater(atlas, { country:'CZ', waterId:'removed', waterName:pilot.name }), undefined);
});
