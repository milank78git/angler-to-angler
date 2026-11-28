const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');

// Include Germanic, Slavic, Romance, Baltic, Uralic, Greek, Turkic and right-to-left UI text.
const locales = 'en cs de sk fr es it pt nl da no sv fi pl uk hr sl lt lv el tr yi'.split(' ');
test('the same behavioral contracts hold in each selected app language', async t => {
  assert.ok(new Set(locales).size >= 20);
  let baseline;
  for (const locale of locales) {
    await t.test(locale, child => {
      const output = execFileSync(process.execPath, [path.join(__dirname, 'scenarios/suite.mjs'), locale], {encoding: 'utf8'});
      const report = JSON.parse(output);
      assert.equal(report.locale, locale);
      assert.ok(report.total >= 5000, `Only ${report.total} unique scenarios`);
      baseline ??= report;
      assert.deepEqual(report.counts, baseline.counts);
      assert.equal(report.digest, baseline.digest, 'Languages must execute identical case IDs');
      child.diagnostic(JSON.stringify(report.counts));
    });
  }
});
