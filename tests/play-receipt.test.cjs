const test=require('node:test');
const assert=require('node:assert/strict');
const {fulfill,digest}=require('../supabase/functions/play-purchase/verify.mjs');
test('verified test pack, replay after consume failure, mismatched account, pending, refund and wrong environment',async()=>{
  const holder='fixture-customer', token='fixture-token', ledger=new Map(), events=[];
  const offer={quantity:1,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'};
  const receipt={orderId:'fixture-order',purchaseStateContext:{purchaseState:'PURCHASED'},testPurchaseContext:{fopType:'TEST'},
    obfuscatedExternalAccountId:await digest(holder),regionCode:'CZ',productLineItem:[{productId:'credits_50_czk',productOfferDetails:offer}]};
  const args={holder,token,mode:'test',lookup:async()=>receipt,credit:async a=>{events.push('credit');ledger.set(a.hash,a);},
    consume:async()=>{events.push('consume');throw Error('lost connection');}};
  await assert.rejects(fulfill(args));
  args.consume=async()=>{events.push('consume');offer.consumptionState='CONSUMPTION_STATE_CONSUMED';};
  await fulfill(args);await fulfill(args);
  assert.deepEqual(events,['credit','consume','credit','consume','credit']);assert.equal(ledger.size,1);
  await assert.rejects(fulfill({...args,holder:'other'}));await assert.rejects(fulfill({...args,mode:'live'}));
  offer.refundableQuantity=0;await assert.rejects(fulfill(args));offer.refundableQuantity=1;
  receipt.purchaseStateContext.purchaseState='PENDING';await assert.rejects(fulfill(args));
  assert.equal(events.length,5);
});

test('authenticated push delivery handles app-closed completion, separate stores and full refunds',async()=>{
  const {processNotification}=require('../supabase/functions/play-purchase/verify.mjs');
  const holder='push-owner', token='push-token', account=await digest(holder);
  const sku='credits_50_czk', grants=[], voids=[];
  const receipt={obfuscatedExternalAccountId:account,orderId:'fixture',regionCode:'CZ',testPurchaseContext:{},
    purchaseStateContext:{purchaseState:'PURCHASED'},productLineItem:[{productId:sku,productOfferDetails:{
      quantity:1,refundableQuantity:1,consumptionState:'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'}}]};
  const services={mode:'test',lookup:async t=>{assert.equal(t,token);return receipt;},
    resolveHolder:async binding=>binding===account?holder:null,credit:async a=>grants.push(a),consume:async()=>{},
    voidReceipt:async h=>voids.push(h)};
  const envelope={packageName:'app.anglers.journal',oneTimeProductNotification:{notificationType:1,sku,purchaseToken:token}};
  await processNotification(envelope,services);
  await processNotification(envelope,{...services,mode:'live'});
  await processNotification({...envelope,packageName:'other.app'},services);
  await processNotification({...envelope,testNotification:{}},services);
  assert.equal(grants.length,1);assert.equal(grants[0].holder,holder);
  await processNotification({...envelope,voidedPurchaseNotification:{productType:2,refundType:1,purchaseToken:token}},services);
  assert.deepEqual(voids,[await digest(token)]);
});

test('authenticated push terminates malformed messages and retries unavailable dependencies', async () => {
  const { deliverPush } = require('../supabase/functions/play-purchase/verify.mjs');
  const subscription = 'projects/p/subscriptions/receipts', warnings = [];
  const token = 'fixture-once', sku = 'credits_50_czk';
  const event = { packageName: 'app.anglers.journal', oneTimeProductNotification: { notificationType: 1, sku, purchaseToken: token } };
  const envelope = (payload, topic = subscription) => new Request('https://example.invalid', {
    method: 'POST', body: JSON.stringify({ subscription: topic, message: { data: btoa(JSON.stringify(payload)) } }),
  });
  const services = { mode: 'test', lookup: async () => { throw Error('temporarily unavailable'); } };
  const run = request => deliverPush(request, subscription, services, message => warnings.push(message));
  assert.equal(await run(envelope(event, 'other')), 403);
  assert.equal(await run(new Request('https://example.invalid', { method: 'POST', body: '{' })), 204);
  assert.equal(await run(envelope({ ...event, oneTimeProductNotification: { notificationType: 1, sku } })), 204);
  await assert.rejects(run(envelope(event)), /unavailable/);
  services.lookup = async () => { throw Object.assign(new Error('expired'), {response: {status: 410}}); };
  assert.equal(await run(envelope(event)), 204);
  const rejected = (status, reason) => async () => {
    throw Object.assign(new Error('Play lookup failed'), {response: {status, data: {error: {errors: [{reason}]}}}});
  };
  for (const reason of ['purchaseTokenMismatch', 'invalidValue']) {
    services.lookup = rejected(400, reason);
    assert.equal(await run(envelope(event)), 204);
  }
  for (const status of [400, 401, 403, 404, 429, 500]) {
    services.lookup = rejected(status, 'unknown');
    await assert.rejects(run(envelope(event)), /Play lookup failed/);
  }
  services.lookup = async () => ({purchaseStateContext: {purchaseState: 'PENDING'}});
  await assert.rejects(run(envelope(event)), /not ready/);
  assert.ok(warnings.length >= 2 && warnings.every(message => !message.includes(token)));
});
