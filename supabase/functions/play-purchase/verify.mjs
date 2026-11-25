const skuSet=new Set(['credits_50_czk','credits_100_czk']);
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),
  x=>x.toString(16).padStart(2,'0')).join('');

/** Verify the Google response and its account binding before making a durable, idempotent grant. */
export async function fulfill({token,holder,mode,lookup,credit,consume}) {
  if (!['test','live'].includes(mode) || typeof token!=='string' || !token.length || token.length>4096) throw Error('Invalid request');
  const purchase=await lookup(token);
  const lines=purchase.productLineItem;
  if (purchase.obfuscatedExternalAccountId!==await digest(holder) || !purchase.orderId ||
    purchase.purchaseStateContext?.purchaseState!=='PURCHASED' || Boolean(purchase.testPurchaseContext)!==(mode==='test') ||
    purchase.regionCode!=='CZ' || !Array.isArray(lines) || lines.length!==1) throw Error('Ineligible purchase');
  const {productId:sku,productOfferDetails:offer}=lines[0];
  if (!skuSet.has(sku) || !offer || offer.quantity!==1 || offer.refundableQuantity!==1 ||
      !['CONSUMPTION_STATE_CONSUMED','CONSUMPTION_STATE_YET_TO_BE_CONSUMED'].includes(offer.consumptionState))
    throw Error('Unsupported product');
  await credit({mode,sku,holder,order:purchase.orderId,hash:await digest(token)});
  if (offer.consumptionState!=='CONSUMPTION_STATE_CONSUMED') await consume(sku,token);
}
