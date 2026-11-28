const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const assets = resolve(__dirname, '../app/src/main/assets');
const json = file => JSON.parse(readFileSync(resolve(assets, file)));

test('every packaged locale has both actions of the discussion composer', () => {
  const keys = ['discussion.compose', 'discussion.reply'];
  for (const file of readdirSync(assets).filter(name => /^strings-.*\.json$/.test(name))) {
    const messages = json(file);
    for (const key of keys) assert.ok(messages[key]?.trim(), file + ' ' + key);
  }
});

test('discussion actions use the selected locale with English fallback per missing key', async () => {
  const originalFetch = global.fetch, originalDevice = global.Device;
  try {
    for (const tag of ['cs-CZ', 'de-CH', 'sk-SK', 'zz-ZZ']) {
      const code = tag.startsWith('zz') ? 'en' : tag.split('-')[0];
      const expected = json('strings-' + code + '.json')['discussion.compose'];
      global.Device = {localeTag: () => tag};
      global.fetch = async file => {
        if (file === 'ui-locales.json') return {ok:true, json:async () => [...json(file), 'zz']};
        if (file === 'strings-zz.json') return {ok:true, json:async () => ({'discussion.reply':'local'})};
        return {ok:true, json:async () => json(file)};
      };
      const i18n = await import('../app/src/main/assets/i18n.js?locale=' + tag);
      await i18n.loadDictionary();
      assert.equal(i18n.label('discussion.compose'), expected);
      if (tag === 'zz-ZZ') assert.equal(i18n.label('discussion.reply'), 'local');
    }
  } finally { global.Device = originalDevice; global.fetch = originalFetch; }
});

test('regional dictionaries override only their keys and the fishing country does not select the language', async (t) => {
  const originalDevice = global.Device, originalFetch = global.fetch;
  t.after(() => { global.Device = originalDevice; global.fetch = originalFetch; });
  const packs = {
    'ui-locales.json': ['de', 'de-ch', 'en'],
    'strings-en.json': { 'common.help': 'English help', 'common.save': 'English save', 'common.close': 'English close' },
    'strings-de.json': { 'common.help': 'Base help', 'common.save': 'Base save' },
    'strings-de-ch.json': { 'common.help': 'Regional help' },
  };
  global.fetch = async path => ({ ok: Object.hasOwn(packs, path), json: async () => packs[path] });
  for (const [tag, expected] of [['de-CH', ['Regional help', 'Base save', 'English close']],
      ['de-CZ', ['Base help', 'Base save', 'English close']], ['zz-CZ', ['English help', 'English save', 'English close']]]) {
    global.Device = { localeTag: () => tag };
    const i18n = await import('../app/src/main/assets/i18n.js?region=' + tag);
    await i18n.loadDictionary();
    assert.deepEqual(['common.help', 'common.save', 'common.close'].map(i18n.label), expected);
  }
});

test('standalone help resolves every chapter, field hint and guide control in the requested language', async t => {
  const originalLocation = Object.getOwnPropertyDescriptor(global, 'location');
  const originalFetch = global.fetch;
  const originalDevice = global.Device;
  t.after(() => {
    global.fetch = originalFetch;
    global.Device = originalDevice;
    if (originalLocation) Object.defineProperty(global, 'location', originalLocation);
    else delete global.location;
  });
  global.Device = { localeTag: () => 'en' };
  const locales = json('ui-locales.json');
  const chapters = Object.values(json('help-topics.json'));
  const hints = Object.values(json('field-hints.json'));
  const guideSource = readFileSync(resolve(assets, 'guide.js'), 'utf8');
  const controls = [...guideSource.matchAll(/\bt\('([^']+)'\)/g)].map(match => match[1]);
  const keys = [...new Set([...chapters.flatMap(ch => [ch.title, ...ch.steps]),
    ...hints.map(hint => hint.message), ...controls])];
  global.fetch = async path => ({ ok: true, json: async () => json(path) });

  for (const code of locales.filter(code => !code.includes('-'))) {
    Object.defineProperty(global, 'location', {
      configurable: true, value: new URL('https://app.example/guide.html?lang=' + code),
    });
    const i18n = await import('../app/src/main/assets/i18n.js?guide-test=' + code);
    await i18n.loadDictionary();
    const local = json('strings-' + code + '.json');
    assert.equal(i18n.contentLanguage, code);
    for (const key of keys) {
      assert.ok(Object.hasOwn(local, key), code + ' lacks ' + key);
      assert.equal(i18n.label(key), local[key], code + ' ' + key);
    }
  }
});
