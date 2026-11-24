const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pilot = 'app.anglers.journal';

function loadPage(scope, query, hash = '', device = 'Android', language = 'cs-CZ') {
  const actions = ['en', 'cs'].map(lang => ({ lang, link: { hidden: true },
    querySelector() { return this.link; } }));
  const cleared = [];
  const dom = {documentElement: {}, querySelector: () => ({content: scope}), querySelectorAll: () => actions};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web/account/handoff.js'), 'utf8'), {
    URLSearchParams, location: { search: query, hash, pathname: '/angler-to-angler/account/' },
    navigator: { userAgent: device, language }, document: dom,
    history: { replaceState: (_, title, url) => cleared.push(url) }
  });
  return { action: actions.find(row => !row.hidden), cleared };
}

test('a mobile gesture opens only the bundled package and removes the auth query from history', () => {
  const {action, cleared} = loadPage(pilot, '?code=Once-23&next=unknown&access_token=ignored');
  assert.equal(action.lang, 'cs');
  assert.equal(action.link.href, 'intent://account/callback?code=Once-23#Intent;scheme=' + pilot + ';package=' + pilot + ';end');
  assert.deepEqual(cleared, ['/angler-to-angler/account/']);
  assert.equal(loadPage(pilot, '', '#error_code=otp_expired').action.link.href.includes('error_code=otp_expired'), true);
});

test('desktop, reused parameters, tokens and malformed codes only show instructions', () => {
  for (const query of ['?access_token=private', '?code=a&code=b', '?code=x%23Intent', '?code=', '']) {
    assert.equal(loadPage(pilot, query).action.link.hidden, true);
  }
  const desktop = loadPage(pilot, '?code=valid', '', 'Desktop', 'de-DE');
  assert.equal(desktop.action.lang, 'en');
  assert.equal(desktop.action.link.hidden, true);
});

test('generated pilot and preview web pages run only their pinned inline code', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'angler-pages-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const [flags, pkg] of [[[], pilot], [['--preview'], pilot + '.preview']]) {
    execFileSync('python3', [path.join(root, 'scripts/build-account-pages.py'), folder, ...flags]);
    const page = fs.readFileSync(path.join(folder, 'account/index.html'), 'utf8');
    assert.ok(page.includes('name="android-package" content="' + pkg + '"'));
    assert.ok(page.includes('name="referrer" content="no-referrer"'));
    for (const tag of ['script', 'style']) {
      const [, inline] = page.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'));
      const digest = crypto.createHash('sha256').update(inline).digest('base64');
      assert.ok(page.includes(tag + "-src 'sha256-" + digest + "'"));
    }
    assert.ok(!page.includes('<script src='));
  }
});
