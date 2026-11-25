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
  const { countryAt } = await import('../app/src/main/assets/country-lookup.js');
  const borders = json('europe-borders');
  assert.equal(countryAt(borders,{lon:14.42,lat:50.08}),'CZ');
  assert.equal(countryAt(borders,{lon:-6.26,lat:53.35}),'IE');
  assert.equal(countryAt(borders,{lon:-32,lat:49}),'');
  const fish = json('europe-fish').species;
  assert.ok(fish.find(f => f.latin === 'Esox lucius').countries.includes('CZ'));
  assert.ok(fish.some(f => !f.countries.length));
});

test('country and name search preserve marine and migratory fish in the right lists', async () => {
  global.document = { querySelector: () => null };
  const { matchingSpecies } = await import('../app/src/main/assets/fish-catalogue.js');
  const species = json('europe-fish').species.map(fish => ({
    ...fish, label: fish.latin, search: fish.latin.toLowerCase().replaceAll(' ', ''),
  }));
  const matches = (code, query) => matchingSpecies({ species }, code, query).map(fish => fish.latin);
  const marine = 'Alepocephalus agassizii';
  assert.deepEqual(matches('CZ', marine), []);
  assert.deepEqual(matches('IE', marine), [marine]);
  assert.deepEqual(matches('', marine), [marine]);
  assert.deepEqual(matches('CZ', 'Anguilla anguilla'), ['Anguilla anguilla']);
  assert.deepEqual(matches('CZ', 'Hucho hucho'), ['Hucho hucho']);
});

test('all packaged market species can round-trip through the versioned database catalogue', () => {
  const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261124004714_european_market_directory.sql'),'utf8');
  const stored=new Set(migration.split('$fish$')[1].split('\n'));
  for (const row of json('europe-fish').species) assert.ok(stored.has(row.latin),row.latin);
});

test('CZ trout and non-trout sizes are distinct from whole-water closures', () => {
  const rules = json('europe-rules').entries.filter(r => r.country === 'CZ');
  const sizes = (name, waterClass) => rules.filter(r => r.species.includes(name) && r.minCm != null &&
    [waterClass, 'czall'].includes(r.scope)).map(r => r.minCm);
  assert.deepEqual(sizes('Cyprinus carpio','cztrout'),[40]);
  assert.deepEqual(sizes('Esox lucius','cztrout'),[]);
  assert.deepEqual(sizes('Esox lucius','nontrout'),[50]);
  assert.ok(rules.some(r => r.scope==='cztrout' && r.allFreshwater && !r.species.length));
  assert.ok(!rules.some(r => r.species.includes('Oncorhynchus mykiss') && r.closed));
});

test('map navigation uses published coordinates and distinguishes unknown locations', async () => {
  global.document = {querySelector:()=>null};
  const {mapFeature} = await import('../app/src/main/assets/atlas-map.js');
  const outline = [[[[14,49],[15,49],[15,50],[14,49]]]];
  assert.deepEqual(mapFeature({},outline).target,[14,49]);
  assert.deepEqual(mapFeature({lines:[[[3,4],[5,6]]]}).target,[3,4]);
  assert.deepEqual(mapFeature({access:{pt:[1,2]},points:[[3,4]]},outline).target,[1,2]);
  assert.deepEqual(mapFeature({points:[[0,0]]}).target,[0,0]);
  assert.equal(mapFeature({points:[[null,0],[0,100]]}),null);
});

test('dated Czech water rules distinguish water, species, inclusive boundaries and unverified dates', async () => {
  const {scopedFishRules, forFishingDate} = await import('../app/src/main/assets/fish-rules.js');
  const rules = json('europe-rules');
  const trout = scopedFishRules(rules,'CZ','cztrout','Oncorhynchus mykiss');
  assert.deepEqual(trout.species.map(r=>r.minCm), [25]);
  assert.equal(trout.water.length, 1);
  const winter = trout.water[0], source = rules.sources[winter.source];
  const status = day => forFishingDate(winter,source,day);
  assert.equal(status('2026-11-30'),'outside');
  assert.equal(status('2026-12-01'),'closed');
  assert.equal(status('2027-01-01'),'closed');
  assert.equal(status('2027-02-02'),'unverified');
  assert.equal(status('2026-11-23'),'unverified');
  assert.equal(status('2026-02-30'),'unverified');
  assert.equal(forFishingDate(winter,{...source,reviewBy:'2027-06-01'},'2027-04-15'),'closed');
  assert.equal(forFishingDate(winter,{...source,reviewBy:'2027-06-01'},'2027-04-16'),'outside');
  const pike = scopedFishRules(rules,'CZ','nontrout','Esox lucius');
  assert.deepEqual(pike.water, []);
  assert.ok(pike.species.some(r=>r.minCm===50));
  for (const latin of ['Barbus petenyi','Acipenser sturio','Huso huso']) {
    assert.ok(scopedFishRules(rules,'CZ','nontrout',latin).species.some(r=>r.closed?.[0]==='03-16'));
  }
  assert.equal(scopedFishRules(rules,'CZ','nontrout','Huso huso').species.some(r=>r.minCm),false);
});

test('catch history resolves pilot keys and scientific names without guessing from manual entries', async () => {
  global.document = { querySelector: () => null };
  const { catchLatin, catchRulesHtml } = await import('../app/src/main/assets/catch-species.js');
  const pack = json('catalog');
  const directory = { names: new Map(json('europe-fish').species.map(f => [f.latin, f])), rules: json('europe-rules') };
  assert.equal(catchLatin({speciesId:'pike'}, pack, null), 'Esox lucius');
  assert.equal(catchLatin({speciesId:'Perca fluviatilis'}, pack, directory), 'Perca fluviatilis');
  assert.equal(catchLatin({speciesId:null, speciesName:'Esox lucius'}, pack, directory), undefined);
  assert.equal(catchLatin({speciesId:'withdrawn-id', speciesName:'Pike'}, pack, directory), undefined);

  const water = {...pack.waters[0], country:'CZ', trout:false};
  const local = catchRulesHtml(pack, directory, water, '2026-11-30', 'Esox lucius');
  assert.match(local, /60 cm/);
  assert.match(local, /50 cm/);
  assert.doesNotMatch(local, /id="lookup-/);
  const trout = {...water, id:'new-trout-water', trout:true};
  const winter = catchRulesHtml(pack, directory, trout, '2027-01-01', 'Oncorhynchus mykiss');
  assert.equal((winter.match(/data-rule-status="closed"/g) || []).length, 1);
  assert.match(winter, /25 cm/);
  const unidentified = catchRulesHtml(pack, directory, trout, '2027-01-01', undefined);
  assert.match(unidentified, /data-rule-status="closed"/);
  assert.doesNotMatch(unidentified, /25 cm|id="lookup-size"/);
  assert.doesNotMatch(catchRulesHtml(pack, directory, trout, '2028-01-01', 'Oncorhynchus mykiss'), /25 cm/);
  assert.doesNotMatch(catchRulesHtml(pack, directory, {...trout, country:'US'}, '2027-01-01', 'Esox lucius'), /data-rule-status/);
});

test('atlas country hints favour the local network and time zone over the display language', async () => {
  const { suggestedAtlasCountry, countryAt } = await import('../app/src/main/assets/country-lookup.js');
  const waters = [{country:'CZ',zone:'Europe/Prague'}, {country:'IE',zone:'Europe/Dublin'},
    {country:'US',zone:'America/Denver'}, {country:'SK',zone:'Europe/Bratislava'}];
  assert.equal(suggestedAtlasCountry(waters, 'cz', 'Europe/Dublin', 'en-US'), 'CZ');
  assert.equal(suggestedAtlasCountry(waters, '', 'Europe/Prague', 'en-US'), 'CZ');
  assert.equal(suggestedAtlasCountry(waters, '', 'UTC', 'en-CZ'), 'CZ');
  assert.equal(suggestedAtlasCountry(waters, '', 'UTC', 'cs'), 'CZ');
  assert.equal(suggestedAtlasCountry(waters, '', 'UTC', 'und'), '');
  assert.equal(suggestedAtlasCountry(waters, 'sk', 'Europe/Prague', 'cs'), 'SK');
  assert.equal(countryAt(json('us-borders'), {lon:-113.67,lat:46.92}), 'US');
  assert.equal(countryAt(json('us-borders'), {lon:-114.07,lat:51.05}), '');
});
