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

test('a reader reports the visible card and clears the action after navigating to a withdrawn card', async t => {
  const { JSDOM } = require('jsdom');
  const root = path.resolve(__dirname, '..');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'angler-reader-report-'));
  t.after(() => fs.rmSync(output, {recursive:true,force:true}));
  execFileSync('python3',[path.join(root,'scripts/build-public-reader.py'),
    path.join(root,'android-smoke/account-config.json'),output]);
  fs.writeFileSync(path.join(output,'package.json'),'{"type":"module"}');
  const id = 'ab000000-0000-4000-8000-000000000071';
  const dom = new JSDOM(fs.readFileSync(path.join(output,'index.html'),'utf8'),{
    url:'https://reader.test/#'+id, pretendToBeVisual:true});
  const reports = [];
  let available = true;
  const fetch = async (url, opts) => {
    if (!opts) return {ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(output,url)))};
    if (url.endsWith('/angler_report_catch_card')) {
      reports.push(JSON.parse(opts.body));
      return {ok:true};
    }
    assert.ok(url.endsWith('/angler_open_catch_card'));
    return {ok:true,text:async()=>available ? JSON.stringify({species:'Pike',name:'River',date:'2026-10',precision:'month'}) : ''};
  };
  for (const [key,value] of Object.entries({fetch,window:dom.window,document:dom.window.document,location:dom.window.location})) {
    const original = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>original ? Object.defineProperty(globalThis,key,original) : delete globalThis[key]);
  }
  t.after(()=>dom.window.close());
  await import(pathToFileURL(path.join(output,'reader.js')).href);
  await new Promise(resolve=>setImmediate(resolve));
  const button=document.querySelector('#report');
  assert.equal(button.hidden,false);
  await button.onclick();
  assert.deepEqual(reports,[{link_id:id}]);
  assert.equal(document.querySelector('#report-status').textContent,'Reported');
  available=false;
  dom.window.dispatchEvent(new dom.window.Event('hashchange'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(button.hidden,true);
  assert.equal(button.onclick,null);
});
