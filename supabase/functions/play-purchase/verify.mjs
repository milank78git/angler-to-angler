/** Reject empty, non-string or oversized purchase tokens before contacting the store. */
const validToken = token => typeof token === 'string' && token.length > 0 && token.length <= 4096;
const skuSet=new Set(['credits_50_czk','credits_100_czk']);
/** Hash the UTF-8 purchase identifier before using it as a ledger key. */
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),
  x=>x.toString(16).padStart(2,'0')).join('');

/** Verify the Google response and its account binding before making a durable, idempotent grant. */
export async function fulfill({token,holder,mode,lookup,credit,consume}) {
  if (!['test','live'].includes(mode) || typeof token!=='string' || !token.length || token.length>4096) throw Error('Invalid request');
  const purchase=await lookup(token);
  const lines=purchase.productLineItem;
  if (purchase.obfuscatedExternalAccountId!==await digest(holder) || !purchase.orderId ||
    purchase.purchaseStateContext?.purchaseState!=='PURCHASED' || Boolean(purchase.testPurchaseContext)!==(mode==='test') ||
    purchase.regionCode!=='CZ' || !Array.isArray(lines) || lines.length!==1) throw new IneligiblePurchase('Ineligible purchase');
  const {productId:sku,productOfferDetails:offer}=lines[0];
  if (!skuSet.has(sku) || !offer || offer.quantity!==1 || offer.refundableQuantity!==1 ||
      !['CONSUMPTION_STATE_CONSUMED','CONSUMPTION_STATE_YET_TO_BE_CONSUMED'].includes(offer.consumptionState))
    throw new IneligiblePurchase('Unsupported product');
  await credit({mode,sku,holder,order:purchase.orderId,hash:await digest(token)});
  if (offer.consumptionState!=='CONSUMPTION_STATE_CONSUMED') await consume(sku,token);
}

/** Complete a purchase even when its owner closes the app before Play confirms payment. */
export async function processNotification(event, services) {
  if (!['test','live'].includes(services.mode)) throw Error('Unknown Play environment');
  if (event.packageName!=='app.anglers.journal' || event.testNotification) return;
  const voided=event.voidedPurchaseNotification;
  if (voided?.productType===2 && voided.refundType===1) {
    if (!validToken(voided.purchaseToken)) throw new IneligiblePurchase('Missing purchase token');
    await services.voidReceipt(await digest(voided.purchaseToken));
    return;
  }
  const notice=event.oneTimeProductNotification;
  if (notice?.notificationType!==1 || !skuSet.has(notice.sku)) return;
  if (!validToken(notice.purchaseToken)) throw new IneligiblePurchase('Missing purchase token');
  let purchase;
  try { purchase = await services.lookup(notice.purchaseToken); }
  catch (error) {
    const response = error?.response;
    const reasons = response?.data?.error?.errors;
    // A 400 can also be a configuration error. Only explicit token errors are terminal.
    if (response?.status === 410 || (response?.status === 400 && Array.isArray(reasons) &&
        reasons.some(entry => ['purchaseTokenMismatch', 'invalidValue'].includes(entry?.reason)))) {
      throw new IneligiblePurchase('Invalid purchase token');
    }
    throw error;
  }
  if (!purchase?.purchaseStateContext?.purchaseState || purchase.purchaseStateContext.purchaseState==='PENDING') {
    throw Error('Play purchase not ready');
  }
  if (Boolean(purchase.testPurchaseContext)!==(services.mode==='test') ||
      purchase.purchaseStateContext?.purchaseState==='CANCELLED' ||
      purchase.productLineItem?.[0]?.productOfferDetails?.refundableQuantity===0) return;
  if (!purchase.obfuscatedExternalAccountId) return;
  const holder=await services.resolveHolder(purchase.obfuscatedExternalAccountId);
  // Test and production projects can subscribe to the same package. Deleted accounts receive no grants.
  if (!holder) return;
  await fulfill({...services,holder,token:notice.purchaseToken,lookup:async()=>purchase});
}

/** An authenticated, subscribed push is acknowledged only when it was handled or cannot ever apply. */
export async function deliverPush(request, subscription, services, warn = console.warn) {
  let envelope;
  try { envelope = await request.json(); }
  catch { warn('Invalid Play push envelope'); return 204; }
  if (typeof envelope?.subscription !== 'string') { warn('Missing Play subscription'); return 204; }
  if (envelope.subscription !== subscription) return 403;
  let event;
  try {
    const data = envelope.message?.data;
    if (typeof data !== 'string' || data.length > 131072) throw Error();
    event = JSON.parse(atob(data));
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error();
  } catch { warn('Invalid Play push data'); return 204; }
  try { await processNotification(event, services); }
  catch (error) {
    if (!(error instanceof IneligiblePurchase)) throw error;
    warn('Ineligible Play notification');
  }
  return 204;
}

export class IneligiblePurchase extends Error {}
