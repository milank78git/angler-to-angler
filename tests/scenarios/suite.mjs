import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const assets = new URL('../../app/src/main/assets/', import.meta.url);
const json = (name) => JSON.parse(readFileSync(new URL(name, assets), 'utf8'));
const [locale, familyFilter, caseFilter] = process.argv.slice(2);
assert.ok(json('ui-locales.json').includes(locale), `Unknown packaged language: ${locale}`);
const dom = new JSDOM(readFileSync(new URL('index.html', assets), 'utf8'), { url: 'https://journal.test/' });
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  Option: window.Option,
  Event: window.Event,
  Element: window.Element,
  Image: window.Image,
  FormData: window.FormData,
  localStorage: window.localStorage,
  Device: { localeTag: () => locale },
  indexedDB: new IDBFactory(),
  IDBKeyRange,
  fetch: async (file) => {
    try {
      const data = json(file);
      return { ok: true, json: async () => data };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { ok: false };
    }
  },
});
window.Device = globalThis.Device;
// jsdom implements the DOM and form controls; only native dialog opening and closing need adapters.
window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function (value) {
  this.open = false;
  this.returnValue = value;
};
// The production loader reads its language on first import. A fresh process also isolates DOM and IDB state.
const i18n = await import('../../app/src/main/assets/i18n.js');
await i18n.loadDictionary();
assert.equal(i18n.contentLanguage, locale);
const dictionary = { ...json('strings-en.json'), ...json(`strings-${locale}.json`) };
function words(key) {
  assert.equal(typeof dictionary[key], 'string', `Missing reference message: ${key}`);
  return dictionary[key];
}
const families = [
  'navigation',
  'bridge',
  'public-cards',
  'catch-entry',
  'field-guide',
  'field-rules',
  'online-screens',
  'journal-restore',
  'community-ratings',
  'community-writes',
  'app-journeys',
];
const counts = {},
  seen = new Set(),
  digest = createHash('sha256');
try {
  for (const family of families.filter((name) => !familyFilter || name === familyFilter)) {
    counts[family] = 0;
    const { run } = await import(`./${family}.mjs`);
    // Count only completed assertions. A case ID excludes the language and must identify a unique contract input.
    await run({
      locale,
      json,
      words,
      async check(id, verify) {
        if (caseFilter && id !== caseFilter) return;
        const key = `${family}/${id}`;
        assert.ok(!seen.has(key), `Duplicate scenario ${key}`);
        try {
          await verify();
        } catch (cause) {
          throw new Error(
            `Reproduce: node tests/scenarios/suite.mjs ${locale} ${family} ${JSON.stringify(id)}`,
            { cause },
          );
        }
        seen.add(key);
        digest.update(key + '\n');
        counts[family]++;
      },
    });
    assert.ok(counts[family], `No scenarios selected in ${family}`);
  }
  assert.ok(seen.size, 'No matching suite');
  console.log(JSON.stringify({ locale, counts, total: seen.size, digest: digest.digest('hex') }));
} finally {
  window.close();
}
