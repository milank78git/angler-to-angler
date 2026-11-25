import { rpc, failure } from './profile-api.js';
import { by, t, button, confirmAction, toast } from './ui.js';
import { languageTag } from './i18n.js';

const dispatch=(op,args={})=>rpc('commerce',{op,args});
const money=halers=>new Intl.NumberFormat(languageTag,{style:'currency',currency:'CZK'}).format(halers/100);
const packs=['credits_50_czk','credits_100_czk'];
export const playEdition=()=>!!window.PlayMarket;
export const commerceStatus=offer=>dispatch('status',offer?{offer}:{});
export const commerceDiscover=(water,cursor)=>dispatch('discover',{water,cursor});
export const commercePublish=args=>dispatch('publish',args);
export const commerceBuy=(offer,revision,price)=>dispatch('buy',{offer,revision,price});
export const estimate=credits=>t('commerce.estimate').replace('{amount}',money(Math.round(credits*100/1.21*0.85*0.85)));
export function enrollment(view,nav,item) {
  const node=by('commerce-enroll');
  if (!node) return;
  node.onclick=async()=>{
    if (!await confirmAction({title:t('commerce.enroll'),message:t('commerce.split')+' '+estimate(item.price),accept:t('commerce.enroll')})) return;
    try { await dispatch('enroll',{offer:item.id,revision:item.revision}); if (view.active()) nav.show(); }
    catch(error) { toast(failure(error)); }
  };
}
export function walletPanel(view,nav,data) {
  const panel=by('commerce-wallet');
  if (!panel) return;
  const line=text=>{const p=document.createElement('p');p.textContent=text;panel.append(p);};
  line(t('commerce.'+(data.mode==='test'?'test':data.mode==='off'?'off':'live')));
  if (data.mode==='off') return;
  line(t('commerce.welcome'));
  line(t('commerce.balance').replace('{amount}',String(data.balance)));
  line(t('commerce.earned').replace('{amount}',money(data.earned)));
  line(t('commerce.pending').replace('{amount}',String(data.pendingCredits)));
  line(t('commerce.requested').replace('{amount}',money(data.requested)));
  line(t('commerce.paid').replace('{amount}',money(data.paid)));
  line(t('commerce.split'));
  const prices=document.createElement('div');panel.append(prices);
  const result=document.createElement('p');result.setAttribute('role','status');panel.append(result);
  const catalogStatus=document.createElement('p');catalogStatus.setAttribute('role','status');panel.append(catalogStatus);
  const checkout=document.createElement('p');checkout.setAttribute('role','status');panel.append(checkout);
  const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.hidden=true;
  retry.textContent=t('common.retry');retry.onclick=()=>window.PlayMarket.refresh();panel.append(retry);
  let catalogUnavailable=false, receiptRetry=false;
  window.playMarketResult=(state,items)=>{
    if (!view.active()) return;
    if (state==='credited' || state==='refreshBalance') { nav.show();return; }
    if (state==='prices') {
      prices.replaceChildren();
      for (const sku of packs) if (items[sku]) {
        const buy=document.createElement('button');
        buy.type='button';buy.textContent=t('commerce.pack').replace('{count}',sku.split('_')[1]).replace('{price}',items[sku]);
        buy.onclick=()=>{ checkout.textContent='';window.PlayMarket.buy(sku); };prices.append(buy);
      }
      catalogUnavailable=false;
      catalogStatus.textContent='';
    } else if (state==='unavailable') {
      catalogUnavailable=true;
      prices.replaceChildren();
      catalogStatus.textContent=t('commerce.unavailable');
    } else if (state==='purchases') {
      receiptRetry=items.retry;
      result.textContent=[items.pending && t('commerce.payment_pending'),items.verifying && t('commerce.verifying'),
        items.retry && t('commerce.delivery_retry')].filter(Boolean).join(' ');
      if (checkout.dataset.error) { checkout.textContent='';delete checkout.dataset.error; }
    } else if (state==='purchaseUnavailable') {
      checkout.dataset.error='1';
      checkout.textContent=t('commerce.purchase_unavailable');
    } else if (state==='cancelled') {
      delete checkout.dataset.error;
      checkout.textContent=t('commerce.cancelled');
    }
    retry.hidden=!(catalogUnavailable || receiptRetry || checkout.dataset.error);
  };
  window.PlayMarket.refresh();
  line(t('commerce.threshold').replace('{count}',String(data.published)));
  if (data.earned>=10000 && !data.requested && (data.priorPayout || data.published>=3)) {
    panel.insertAdjacentHTML('beforeend',button('commerce-payout',t('commerce.payout'),'secondary'));
    by('commerce-payout').onclick=async()=>{
      if (!await confirmAction({title:t('commerce.payout'),message:money(data.earned),accept:t('commerce.payout')})) return;
      try { await dispatch('payout'); if (view.active()) nav.show(); } catch(error) { toast(failure(error)); }
    };
  }
}
