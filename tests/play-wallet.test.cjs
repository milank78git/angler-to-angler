const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('pending, concurrent, retried and consumed Android receipts', t => {
  const classes = mkdtempSync(join(tmpdir(), 'angler-play-'));
  t.after(() => rmSync(classes, { recursive: true, force: true }));
  execFileSync('java', ['-m', 'jdk.compiler/com.sun.tools.javac.Main', '-d', classes,
    'app/src/play/java/app/anglers/journal/PlayReceipts.java', 'tests/PlayReceiptsTest.java']);
  execFileSync('java', ['-cp', classes, 'app.anglers.journal.PlayReceiptsTest']);
});

class Element {
  children = [];
  textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
}

// Deliver SDK and account responses in different orders through the actual wallet and RPC bindings.
test('wallet keeps independent errors, updates the current balance and retires callbacks on navigation', async t => {
  const panel = new Element();
  const purchases = [], requests = [];
  let checks = 0, active = true, disposed = false;
  const view = { active: () => active, dispose: () => { disposed = true; } };
  global.document = { querySelector: () => null, getElementById: () => panel, createElement: () => new Element() };
  global.window = {
    PlayMarket: { refresh: () => checks++, buy: sku => purchases.push(sku) },
    Device: { profileRequest: (id, op, args) => {
      assert.equal(op, 'commerce');
      assert.deepEqual(JSON.parse(args), { op: 'status', args: {} });
      requests.push(id);
    } },
  };
  t.after(() => { delete global.document; delete global.window; });
  const dictionary = require('../app/src/main/assets/strings-en.json');
  const originalFetch = global.fetch;
  global.fetch = async path => ({ ok: true, json: async () => path === 'ui-locales.json' ? [] : dictionary });
  t.after(() => { global.fetch = originalFetch; });
  const { loadDictionary } = await import('../app/src/main/assets/i18n.js');
  await loadDictionary();
  const { walletPanel } = await import('../app/src/main/assets/commerce.js');
  walletPanel(view, { show() { assert.fail('Billing must not reopen the market'); } },
    { mode: 'test', balance: 10, earned: 0, pendingCredits: 0, requested: 0, paid: 0, published: 0 });
  const report = window.playMarketResult;
  const status = panel.children.find(el => el.role === 'status');
  const retry = panel.children.find(el => el.textContent === dictionary['common.retry']);
  const balance = panel.children.find(el => el.textContent === dictionary['commerce.balance'].replace('{amount}', '10'));
  const shows = key => status.textContent.includes(dictionary[key]);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const prices = { credits_50_czk: { credits: 50, price: 'CZK 50' } };

  report('purchases', { pending: true });
  report('prices', prices);
  assert.ok(shows('commerce.payment_pending'));
  const pack = panel.children.flatMap(el => el.children).find(el => el.type === 'button');
  pack.onclick();
  report('checkoutUnavailable');
  report('purchases', { verifying: true });
  assert.ok(shows('commerce.checkout_unavailable') && shows('commerce.verifying'));
  assert.ok(!shows('commerce.payment_pending'));
  report('inventoryUnavailable');
  report('purchases', { retry: true });
  report('unavailable');
  report('prices', prices);
  assert.ok(shows('commerce.delivery_retry') && shows('commerce.purchase_unavailable'));
  assert.equal(retry.hidden, false);
  retry.onclick();
  assert.equal(checks, 2);
  assert.deepEqual(purchases, ['credits_50_czk']);

  report('inventoryLoaded');
  report('balanceChanged');
  window.profileReply(requests[1], 200, { balance: 60 });
  await settle();
  window.profileReply(requests[0], 200, { balance: 10 });
  await settle();
  assert.equal(balance.textContent, dictionary['commerce.balance'].replace('{amount}', '60'));
  report('purchases', {});
  report('cancelled');
  assert.ok(shows('commerce.cancelled'));
  assert.equal(retry.hidden, true);

  report('balanceChanged');
  window.profileReply(requests[2], 503, {});
  await settle();
  assert.ok(shows('commerce.balance_unavailable'));
  retry.onclick();
  active = false;
  view.dispose();
  assert.ok(disposed);
  assert.equal(window.playMarketResult, undefined);
  window.profileReply(requests[3], 200, { balance: 100 });
  await settle();
  assert.equal(balance.textContent, dictionary['commerce.balance'].replace('{amount}', '60'));
  assert.equal(purchases.length, 1);
});

test('checkout quotes promotional, mixed and paid purchases before confirmation', async () => {
  const { purchaseFunding } = await import('../app/src/main/assets/commerce.js');
  assert.equal(purchaseFunding({ balance: 10 }, 5, 1), null);
  assert.deepEqual(purchaseFunding({ balance: 10, welcomeBalance: 10 }, 5, null),
    { welcome: 5, paid: 0, available: true });
  assert.deepEqual(purchaseFunding({ balance: 10, welcomeBalance: 10 }, 5, 1),
    { welcome: 4, paid: 1, available: false });
  assert.deepEqual(purchaseFunding({ balance: 11, welcomeBalance: 10 }, 1, 2),
    { welcome: 0, paid: 1, available: true });
  assert.deepEqual(purchaseFunding({ balance: 6, welcomeBalance: 2 }, 6, 1),
    { welcome: 2, paid: 4, available: true });
});
