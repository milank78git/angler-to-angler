import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setImmediate as settle } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const first = 'ac000000-0000-4000-8000-000000000001';
const second = 'ac000000-0000-4000-8000-000000000002';

function visibleCard(owner) {
  return { name: owner, species: 'Fish of ' + owner, date: '2024-05', precision: 'month' };
}

// Delay transport and body decoding independently. An abort cannot recall a callback already queued.
async function withReader(output, id, locale, verify) {
  const dom = new JSDOM(readFileSync(join(output, 'index.html'), 'utf8'), {
    url: 'https://reader.test/#' + first,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  Object.defineProperty(window.navigator, 'language', { value: locale });
  const requests = [];
  function fetch(url, options) {
    if (!options)
      return Promise.resolve({ ok: true, json: async () => JSON.parse(readFileSync(join(output, url))) });
    const { promise, resolve } = Promise.withResolvers();
    requests.push({ operation: String(url).split('/').at(-1), options, resolve });
    return promise;
  }
  const globals = {
    window,
    document,
    location: window.location,
    navigator: window.navigator,
    Device: undefined,
    fetch,
  };
  const saved = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const by = (id) => document.getElementById(id);
  function request(index, operation, link) {
    const req = requests[index];
    assert.ok(req, 'No request ' + index);
    assert.equal(req.operation, 'angler_' + operation + '_catch_card');
    assert.deepEqual(JSON.parse(req.options.body), { link_id: link });
    assert.equal(req.options.credentials, 'omit');
    assert.equal(req.options.referrerPolicy, 'no-referrer');
    if (operation === 'open') assert.equal(req.options.cache, 'no-store');
    return req;
  }
  async function deliver(req, body, ok = true) {
    req.resolve({ ok, text: async () => body });
    await settle();
  }
  function changeLink(token) {
    window.history.replaceState(null, '', '#' + token);
    window.dispatchEvent(new window.Event('hashchange'));
  }
  try {
    const url = pathToFileURL(join(output, 'reader.js'));
    url.searchParams.set('case', id);
    await import(url.href);
    assert.equal(document.documentElement.lang, locale);
    await verify({ by, window, document, request, requests, deliver, changeLink });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
export async function run({ check, words, locale }) {
  const output = mkdtempSync(join(tmpdir(), 'angler-public-race-'));
  try {
    execFileSync('python3', [
      join(root, 'scripts/build-public-reader.py'),
      join(root, 'android-smoke/account-config.json'),
      output,
    ]);
    writeFileSync(join(output, 'package.json'), '{"type":"module"}');
    const scenario = (id, verify) => check(id, () => withReader(output, id, locale, verify));
    await scenario(
      'late-body-cannot-replace-next-link',
      async ({ by, document, request, deliver, changeLink }) => {
        const old = request(0, 'open', first);
        const body = Promise.withResolvers();
        old.resolve({ ok: true, text: () => body.promise });
        await settle();
        changeLink(second);
        const latest = request(1, 'open', second);
        assert.equal(old.options.signal.aborted, true);
        await deliver(latest, JSON.stringify(visibleCard('Second')));
        body.resolve(JSON.stringify(visibleCard('First')));
        await settle();
        assert.equal(
          by('content').querySelector('h2').textContent,
          'Fish of Second',
          'A retired response replaced the visible card',
        );
        assert.ok(document.title.includes('Fish of Second'));
        const reporting = by('report').onclick();
        await deliver(request(2, 'report', second), '');
        await reporting;
        assert.equal(by('report-status').textContent, words('common.reported'));
      },
    );
    await scenario(
      'hide-while-reporting-and-restore-revoked-link',
      async ({ by, window, document, request, requests, deliver }) => {
        await deliver(request(0, 'open', first), JSON.stringify(visibleCard('Visible')));
        const reporting = by('report').onclick();
        const pending = request(1, 'report', first);
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new window.Event('visibilitychange'));
        assert.equal(by('content').childElementCount, 0, 'Private card retained while the page was hidden');
        assert.equal(by('report').hidden, true);
        assert.equal(by('report').onclick, null);
        assert.equal(requests.length, 2);
        await deliver(pending, '');
        await reporting;
        assert.equal(by('report-status').textContent, '', 'A retired report updated the hidden page');
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        window.dispatchEvent(new window.PageTransitionEvent('pageshow', { persisted: true }));
        await deliver(request(2, 'open', first), '');
        assert.equal(
          by('content').textContent,
          words('public_reader.this_card_is_unavailable_its_author_may'),
        );
        assert.equal(by('report').hidden, true);
        assert.ok(!document.title.includes('Visible'));
      },
    );
    await scenario('service-unavailable-retry-and-confirmed-missing', async ({ by, request, deliver }) => {
      await deliver(request(0, 'open', first), '', false);
      assert.equal(by('retry').hidden, false, 'Service failure was presented as a confirmed missing card');
      assert.equal(by('content').textContent, words('public_reader.could_not_load_the_card_check_your'));
      const retried = by('retry').onclick();
      await deliver(request(1, 'open', first), 'null');
      await retried;
      assert.equal(by('retry').hidden, true);
      assert.equal(by('content').textContent, words('public_reader.this_card_is_unavailable_its_author_may'));
      assert.equal(by('report').hidden, true);
    });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}
