const test = require('node:test');
const assert = require('node:assert/strict');

// Simulate independent Billing callbacks against the same wallet view.
test('price refresh preserves pending payments and retry only checks ownership', async () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.textContent = ''; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
  }
  const panel = new Element();
  let checks = 0, purchases = 0, balanceReads = 0;
  global.document = { querySelector: () => null, getElementById: () => panel, createElement: () => new Element() };
  global.window = { PlayMarket: { refresh: () => checks++, buy: () => purchases++ } };
  const { walletPanel } = await import('../app/src/main/assets/commerce.js');
  walletPanel({ active: () => true }, { show: () => balanceReads++ },
    { mode: 'test', balance: 10, earned: 0, pendingCredits: 0, requested: 0, paid: 0, published: 0 });
  const report = window.playMarketResult;
  const visible = key => panel.children.some(el => el.textContent.includes(key));
  report('purchases', { pending: true });
  report('prices', { credits_50_czk: '50 Kč' });
  assert.ok(visible('commerce.payment_pending'));
  report('purchases', { verifying: true });
  assert.ok(visible('commerce.verifying'));
  assert.ok(!visible('commerce.payment_pending'));
  report('purchases', { retry: true });
  report('unavailable');
  report('prices', { credits_50_czk: '50 Kč' });
  const retry = panel.children.find(el => el.textContent === 'common.retry');
  assert.ok(visible('commerce.delivery_retry'));
  assert.equal(retry.hidden, false);
  retry.onclick();
  assert.equal(checks, 2);
  assert.equal(purchases, 0);
  report('credited');
  assert.equal(balanceReads, 1);
  report('purchases', {});
  assert.equal(retry.hidden, true);
  report('cancelled');
  assert.ok(visible('commerce.cancelled'));
  assert.equal(balanceReads, 1);
});
