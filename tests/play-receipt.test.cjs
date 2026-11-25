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
