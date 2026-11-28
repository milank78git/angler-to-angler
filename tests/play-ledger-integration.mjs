// Run after applying the project fixture in the disposable payment database. Google responses are
// synthetic. The same fulfillment functions as the client and push endpoints call the installed RPCs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import {
  deliverPush,
  digest,
  fulfill,
  IneligiblePurchase,
} from '../supabase/functions/play-purchase/verify.mjs';

globalThis.crypto ??= webcrypto;
function sql(statement, variables = {}) {
  const bindings = Object.entries(variables).flatMap(([k, v]) => ['-v', k + '=' + v]);
  const result = spawnSync(
    'psql',
    ['-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...bindings],
    {
      input: statement,
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr.trim());
  return result.stdout.trim();
}
assert.equal(sql('select current_database();'), 'angler_payment_test');
sql("update angler_commerce.settings set mode='test';");
const seller = randomUUID(),
  buyer = randomUUID(),
  other = randomUUID(),
  offer = randomUUID();
const asUser = 'begin; set local role authenticated; set local "request.jwt.claim.sub"=:\'actor\'; ';
for (const actor of [seller, buyer, other]) {
  sql(
    "insert into auth.users(id,email_confirmed_at) values(:'actor',now()); " +
      asUser +
      "select public.angler_register(:'name','2026-11-26.2','2026-11-26.2','1980-01-01'); commit;",
    { actor, name: 'Angler ' + actor.slice(0, 8) },
  );
}
function commerce(actor, op, args = {}) {
  return JSON.parse(
    sql(asUser + "select public.angler_commerce(:'op',:'args'::jsonb); commit;", {
      actor,
      op,
      args: JSON.stringify(args),
    }),
  );
}
function ledger(op, args) {
  try {
    return JSON.parse(
      sql("set role service_role; select public.angler_play_receipt(:'op',:'args'::jsonb);", {
        op,
        args: JSON.stringify(args),
      }),
    );
  } catch (error) {
    if (op === 'credit' && /PT410/.test(error.message)) throw new IneligiblePurchase('Voided receipt');
    throw error;
  }
}
function detail(actor) {
  return JSON.parse(sql(asUser + "select public.angler_market_detail(:'offer'); commit;", { actor, offer }));
}
function orderState() {
  return JSON.parse(
    sql(
      `select json_build_array(o.sold,
    (select count(*) from angler_market.orders b where b.offer=o.id),
    (select count(*) from angler_commerce.sales s where s.offer=o.id and not s.voided),
    (select count(*) from angler_market.versions v where v.offer=o.id))
    from angler_market.offers o where o.id=:'offer';`,
      { offer },
    ),
  );
}
const draft = {
  title: 'Evening float',
  species: 'Esox lucius',
  access: 'shore',
  day: '2025-01-15',
  water: null,
  technique: 'Start with a short drift.',
  price: 23,
  limit: 1,
};
const publish = (data) => commerce(seller, 'publish', { offer_id: offer, expected_revision: 0, draft: data });
assert.throws(() => publish({ ...draft, price: 0 }), /PT422|22023/);
assert.equal(sql("select count(*) from angler_market.offers where id=:'offer';", { offer }), '0');
publish(draft);
publish(draft);
assert.deepEqual(orderState(), [0, 0, 0, 1]);
assert.throws(() => publish({ ...draft, technique: 'Changed before receiving confirmation.' }), /PT409/);
assert.equal(detail(seller).technique, draft.technique);
assert.ok(!('technique' in detail(buyer)));
assert.equal(commerce(buyer, 'status').balance, 10);
assert.equal(commerce(other, 'status').balance, 10);

const sku = 'credits_50_czk',
  token = randomUUID(),
  order = randomUUID();
const binding = await digest(buyer);
const line = { quantity: 1, refundableQuantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' };
const purchase = {
  orderId: order,
  obfuscatedExternalAccountId: binding,
  regionCode: 'CZ',
  testPurchaseContext: {},
  purchaseStateContext: { purchaseState: 'PENDING' },
  productLineItem: [{ productId: sku, productOfferDetails: line }],
};
let consumeAttempts = 0;
const services = {
  mode: 'test',
  lookup: async (value) => {
    assert.equal(value, token);
    return purchase;
  },
  resolveHolder: async (binding) => ledger('holder', { binding }).holder,
  credit: async (args) => ledger('credit', args),
  consume: async (product, value) => {
    assert.equal(product, sku);
    assert.equal(value, token);
    assert.equal(commerce(buyer, 'status').balance, 60, 'Consume preceded the durable credit');
    if (++consumeAttempts === 1) throw Error('Provider unavailable after credit');
    line.consumptionState = 'CONSUMPTION_STATE_CONSUMED';
  },
  voidReceipt: async (hash) => ledger('void', { hash }),
};
const fromDevice = (holder = buyer) => fulfill({ ...services, token, holder });
const subscription = 'projects/fixture/subscriptions/play';
function fromPush(payload) {
  const event = { packageName: 'app.anglers.journal', ...payload };
  return deliverPush(
    new Request('https://fixture.invalid', {
      method: 'POST',
      body: JSON.stringify({
        subscription,
        message: { data: Buffer.from(JSON.stringify(event)).toString('base64') },
      }),
    }),
    subscription,
    services,
    () => {},
  );
}
const completed = { oneTimeProductNotification: { notificationType: 1, sku, purchaseToken: token } };
const refund = { voidedPurchaseNotification: { productType: 2, refundType: 1, purchaseToken: token } };
await assert.rejects(fromDevice(), IneligiblePurchase);
await assert.rejects(fromPush(completed), /not ready/);
purchase.purchaseStateContext.purchaseState = 'PURCHASED';
await assert.rejects(fromDevice(other), IneligiblePurchase);
assert.equal(sql("select count(*) from angler_commerce.lots where order_ref=:'order';", { order }), '0');
assert.equal(consumeAttempts, 0);
await assert.rejects(fromDevice(), /Provider unavailable after credit/);
assert.equal(commerce(buyer, 'status').balance, 60);
// Closing the app does not lose the purchase. Redelivery and subsequent client replay share one lot.
assert.equal(await fromPush(completed), 204);
await fromDevice();
assert.equal(
  sql(
    "select count(*) from angler_commerce.lots where order_ref=:'order' and holder=:'buyer' and units=50;",
    { order, buyer },
  ),
  '1',
);
assert.equal(consumeAttempts, 2);
const terms = { offer, revision: 1, price: 23, paid: 13 };
assert.throws(() => commerce(buyer, 'buy', { ...terms, paid: 23 }), /PT409/);
assert.deepEqual(orderState(), [0, 0, 0, 1]);
commerce(buyer, 'buy', terms);
commerce(buyer, 'buy', terms);
assert.deepEqual(orderState(), [1, 1, 1, 1]);
assert.equal(commerce(buyer, 'status').balance, 37);
assert.equal(detail(buyer).technique, draft.technique);
assert.ok(!('technique' in detail(other)));
assert.deepEqual(
  JSON.parse(
    sql(
      `select jsonb_object_agg(l.source,a.units) from angler_commerce.allocations a
  join angler_commerce.lots l on l.id=a.lot join angler_commerce.sales s on s.id=a.sale where s.offer=:'offer';`,
      { offer },
    ),
  ),
  { google: 13, welcome: 10 },
);
assert.equal(commerce(seller, 'status').pendingCredits, 13);
assert.equal(await fromPush(refund), 204);
assert.equal(await fromPush(refund), 204);
assert.deepEqual(orderState(), [0, 0, 0, 1]);
assert.ok(!('technique' in detail(buyer)));
assert.equal(commerce(buyer, 'status').balance, 10);
assert.equal(commerce(seller, 'status').pendingCredits, 0);
await assert.rejects(fromDevice(), IneligiblePurchase);
assert.equal(commerce(buyer, 'status').balance, 10);
assert.equal(commerce(other, 'status').balance, 10);
console.log(
  'Play publication, payment delivery, mixed purchase, stock and refund verified against PostgreSQL.',
);
