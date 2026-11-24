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
    for (const [tag,expected] of [['cs-CZ','Přidat poznatek nebo dotaz'],['de-CH','Beobachtung oder Frage hinzufügen'],
      ['sk-SK','Pridať poznatok alebo otázku'],['zz-ZZ','Share an observation or question']]) {
      global.Device = {localeTag: () => tag};
      global.fetch = async file => {
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
