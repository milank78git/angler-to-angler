const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('the trip target and report use the water country, the full catalogue and stable saved keys', async (t) => {
  const assets = path.resolve(__dirname, '../app/src/main/assets');
  const dom = new JSDOM('<main id="screen"></main>');
  const { window } = dom;
  for (const [key, value] of Object.entries({
    window, document: window.document, Option: window.Option, Device: { localeTag: () => 'cs' },
    fetch: async file => ({ ok: true, json: async () => JSON.parse(await fs.readFile(path.join(assets, file), 'utf8')) }),
  })) {
    const before = global[key];
    global[key] = value;
    t.after(() => { if (before === undefined) delete global[key]; else global[key] = before; });
  }
  t.after(() => window.close());
  const { loadDictionary } = await import('../app/src/main/assets/i18n.js');
  await loadDictionary();
  const { fishDirectory } = await import('../app/src/main/assets/fish-catalogue.js');
  const { activityTargetLabel, targetFields, bindTargetPicker } = await import('../app/src/main/assets/activity-target.js');
  const fish = await fishDirectory();
  const pack = require('../app/src/main/assets/catalog.json');
  const by = id => document.getElementById('activity-' + id);
  const options = () => [...by('target').options].map(option => option.value);
  const countrySpecies = fish.species.filter(row => row.countries.includes('CZ')).map(row => row.latin);
  const carp = 'Cyprinus carpio';
  const foreign = 'Alepocephalus agassizii';

  function render(saved, report = false) {
    document.querySelector('main').innerHTML = targetFields('CZ');
    bindTargetPicker(fish, pack, saved, report);
  }
  function search(value) {
    by('search').value = value;
    by('search').dispatchEvent(new window.Event('input'));
  }
  function scope(value) {
    by('scope').value = value;
    by('scope').dispatchEvent(new window.Event('change'));
  }

  render('unspecified');
  assert.equal(by('scope').value, 'CZ');
  assert.equal(by('target').value, 'unspecified');
  assert.deepEqual(new Set(options()), new Set(['unspecified', 'other', ...countrySpecies]));
  assert.ok(options().includes(carp));
  assert.ok(!options().includes(foreign));
  search('kapr obecny');
  assert.ok(options().includes(carp));
  by('target').value = carp;
  search('Esox');
  assert.equal(by('target').value, carp);
  assert.ok(options().includes('Esox lucius'));
  assert.equal(activityTargetLabel(carp, pack, fish), fish.names.get(carp).label);
  render('pike');
  assert.equal(by('target').value, 'Esox lucius');
  assert.equal(activityTargetLabel('pike', pack, fish), fish.names.get('Esox lucius').label);

  render('', true);
  assert.equal(by('target').value, '');
  assert.ok(options().includes('unspecified'));
  scope('');
  const before = options().length;
  by('more').click();
  assert.ok(options().length > before);
  search(foreign);
  by('target').value = foreign;
  assert.equal(by('target').value, foreign);
  render(foreign, true);
  assert.equal(by('scope').value, '');
  assert.equal(by('target').value, foreign);
  scope('CZ');
  assert.equal(by('target').value, '');
  assert.ok(!options().includes(foreign));
  search('missing catalogue fixture');
  assert.deepEqual(options(), ['', 'unspecified', 'other']);
});
