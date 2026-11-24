const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../app/src/main/assets');
const json = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json')));

test('home, water and every navigation destination have a help chapter', () => {
  const guides = json('help-topics');
  const routes = new Set(Object.values(guides).flatMap(ch => ch.pages));
  const app = fs.readFileSync(path.join(dir,'app.js'),'utf8');
  const table = app.split('const views = {')[1].split('};')[0];
  for (const entry of table.split(',').map(s => s.trim()).filter(Boolean)) {
    assert.ok(routes.has(entry.split(':')[0]),entry);
  }
  for (const field of Object.values(json('field-hints'))) assert.ok(guides[field.topic]);
});

test('catalogue identifies inland coordinates and distinguishes sea from missing country evidence', async () => {
  global.document = { querySelector: () => null };
  const { countryAt } = await import('../app/src/main/assets/fish-catalogue.js');
  const borders = json('europe-borders');
  assert.equal(countryAt(borders,{lon:14.42,lat:50.08}),'CZ');
  assert.equal(countryAt(borders,{lon:-6.26,lat:53.35}),'IE');
  assert.equal(countryAt(borders,{lon:-32,lat:49}),'');
  const fish = json('europe-fish').species;
  assert.ok(fish.find(f => f.latin === 'Esox lucius').countries.includes('CZ'));
  assert.ok(fish.some(f => !f.countries.length));
});

test('all packaged market species can round-trip through the versioned database catalogue', () => {
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261124004714_european_market_directory.sql'),'utf8');
  const stored=new Set(migration.split('$fish$')[1].split('\n'));
  for (const row of json('europe-fish').species) assert.ok(stored.has(row.latin),row.latin);
});
