const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('the built public reader renders its first visit when dictionaries arrive after pageshow', async t => {
  const root = path.resolve(__dirname, '..');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'angler-reader-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  execFileSync('python3', [path.join(root, 'scripts/build-public-reader.py'),
    path.join(root, 'android-smoke/account-config.json'), output]);
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module"}');

  const elements = new Map();
  const document = Object.assign(new EventTarget(), {
    documentElement: {}, hidden: false,
    createElement: () => ({}),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        replaceChildren(...nodes) { this.textContent = nodes.map(node => node.textContent).join(''); },
      });
      return elements.get(selector);
    },
  });
  const window = new EventTarget();
  let startLookup, finishLookup;
  const lookup = new Promise(resolve => { startLookup = resolve; });
  const pending = new Promise(resolve => { finishLookup = resolve; });
  const globals = { window, document, location: { pathname: '/index.html', hash: '' },
    Device: { localeTag: () => 'cs-CZ' },
    fetch: async file => {
      startLookup();
      await pending;
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(output, file))) };
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const loaded = import(pathToFileURL(path.join(output, 'reader.js')).href);
  await lookup;
  window.dispatchEvent(new Event('pageshow'));
  finishLookup();
  await loaded;
  const cs = JSON.parse(fs.readFileSync(path.join(root, 'app/src/main/assets/strings-cs.json')));
  assert.equal(document.documentElement.lang, 'cs');
  assert.equal(elements.get('#heading').textContent, cs['public_reader.shared_catch']);
  assert.equal(elements.get('#content').textContent, cs['public_reader.open_the_full_link_the_angler_shared']);
});
