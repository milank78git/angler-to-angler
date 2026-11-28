const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Follow the same catalogue offered by the Android language selector. A new language inherits every contract.
const locales = require('../app/src/main/assets/ui-locales.json');
const minimum = {
  navigation: 5076,
  bridge: 3072,
  'catch-entry': 145,
  'public-cards': 576,
  'public-reader-lifecycle': 3,
  'field-guide': 125,
  'field-rules': 81,
  'online-screens': 182,
  'journal-restore': 60,
  'community-ratings': 8,
  'community-writes': 359,
  'atlas-actions': 22,
  'member-actions': 42,
  'photo-transfer': 15,
  'private-messages': 51,
  'share-preview': 68,
  'native-guide': 36,
  'app-journeys': 13,
};
test('the same behavioral contracts hold in each selected app language', async (t) => {
  assert.equal(new Set(locales).size, locales.length);
  assert.ok(locales.length >= 20);
  let baseline;
  for (const locale of locales) {
    await t.test(locale, (child) => {
      const output = execFileSync(process.execPath, [path.join(__dirname, 'scenarios/suite.mjs'), locale], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const report = JSON.parse(output);
      assert.equal(report.locale, locale);
      assert.ok(report.total >= 5000, `Only ${report.total} unique scenarios`);
      for (const [family, count] of Object.entries(minimum))
        assert.ok(report.counts[family] >= count, `${family} lost scenarios`);
      baseline ??= report;
      assert.deepEqual(report.counts, baseline.counts);
      assert.equal(report.digest, baseline.digest, 'Languages must execute identical case IDs');
      child.diagnostic(JSON.stringify(report.counts));
    });
  }
});
