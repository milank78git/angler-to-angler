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
