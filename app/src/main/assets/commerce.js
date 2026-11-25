import { rpc, failure } from './profile-api.js';
import { by, t, button, confirmAction, toast } from './ui.js';
import { languageTag } from './i18n.js';

const dispatch=(op,args={})=>rpc('commerce',{op,args});
const money=halers=>new Intl.NumberFormat(languageTag,{style:'currency',currency:'CZK'}).format(halers/100);
export const playEdition=()=>!!window.PlayMarket;
export const commerceStatus=offer=>dispatch('status',offer?{offer}:{});
export const commerceDiscover=(water,cursor)=>dispatch('discover',{water,cursor});
export const commercePublish=args=>dispatch('publish',args);
export const commerceBuy = (offer, revision, price, paid) => dispatch('buy', { offer, revision, price, paid });

/** Quote the server's welcome-first allocation, preserving one paid credit for limited stock. */
export function purchaseFunding(wallet, price, limit) {
  if (!Number.isInteger(wallet?.welcomeBalance)) return null;
  const welcome = Math.min(wallet.welcomeBalance, limit == null ? price : price - 1);
  const paid = price - welcome;
  return { welcome, paid, available: wallet.balance - wallet.welcomeBalance >= paid };
}
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
const balanceText = amount => t('commerce.balance').replace('{amount}', String(amount));

/** Billing, inventory and account balance arrive independently. Each updates its own message. */
function bindPlayCheckout(panel, view, balanceLine) {
  const prices = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'secondary';
  retry.textContent = t('common.retry');
  retry.hidden = true;
  panel.append(prices, status, retry);

  const messages = { catalog: '', inventory: '', receipts: '', checkout: '', balance: '' };
  let retryReceipt = false;
  let balanceRequest = 0;
  function render() {
    status.textContent = Object.values(messages).filter(Boolean).join(' ');
    retry.hidden = !(messages.catalog || messages.inventory || retryReceipt || messages.balance);
  }

  async function refreshBalance() {
    const request = ++balanceRequest;
    try {
      const wallet = await commerceStatus();
      if (!view.active() || request !== balanceRequest) return;
      balanceLine.textContent = balanceText(wallet.balance);
      messages.balance = '';
    } catch {
      if (!view.active() || request !== balanceRequest) return;
      messages.balance = t('commerce.balance_unavailable');
    }
    render();
  }

  function showPrices(items) {
    prices.replaceChildren();
    for (const [sku, quote] of Object.entries(items).sort((a, b) => a[1].credits - b[1].credits)) {
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.textContent = t('commerce.pack').replace('{count}', String(quote.credits)).replace('{price}', quote.price);
      buy.onclick = () => {
        messages.checkout = '';
        render();
        window.PlayMarket.buy(sku);
      };
      prices.append(buy);
    }
  }

  function report(event, items) {
    if (!view.active()) return;
    switch (event) {
      case 'prices':
        messages.catalog = '';
        showPrices(items);
        break;
      case 'unavailable':
        messages.catalog = t('commerce.unavailable');
        prices.replaceChildren();
        break;
      case 'inventoryUnavailable':
        messages.inventory = t('commerce.purchase_unavailable');
        break;
      case 'inventoryLoaded':
        messages.inventory = '';
        refreshBalance();
        break;
      case 'purchases':
        retryReceipt = items.retry;
        messages.receipts = [
          items.pending && t('commerce.payment_pending'),
          items.verifying && t('commerce.verifying'),
          items.retry && t('commerce.delivery_retry'),
        ].filter(Boolean).join(' ');
        break;
      case 'balanceChanged':
        refreshBalance();
        break;
      case 'checkoutUnavailable':
        messages.checkout = t('commerce.checkout_unavailable');
        break;
      case 'cancelled':
        messages.checkout = t('commerce.cancelled');
        break;
      default:
        return;
    }
    render();
  }

  retry.onclick = () => {
    if (messages.balance) refreshBalance();
    window.PlayMarket.refresh();
  };
  window.playMarketResult = report;
  const dispose = view.dispose;
  view.dispose = () => {
    if (window.playMarketResult === report) delete window.playMarketResult;
    dispose();
  };
  window.PlayMarket.refresh();
}

export function walletPanel(view,nav,data) {
  const panel=by('commerce-wallet');
  if (!panel) return;
  const line = text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    panel.append(paragraph);
    return paragraph;
  };
  line(t('commerce.'+(data.mode==='test'?'test':data.mode==='off'?'off':'live')));
  if (data.mode==='off') return;
  line(t('commerce.welcome'));
  const balanceLine = line(balanceText(data.balance));
  line(t('commerce.earned').replace('{amount}',money(data.earned)));
  line(t('commerce.pending').replace('{amount}',String(data.pendingCredits)));
  line(t('commerce.requested').replace('{amount}',money(data.requested)));
  line(t('commerce.paid').replace('{amount}',money(data.paid)));
  line(t('commerce.split'));
  bindPlayCheckout(panel, view, balanceLine);
  line(t('commerce.threshold').replace('{count}',String(data.published)));
  if (data.earned>=10000 && !data.requested && (data.priorPayout || data.published>=3)) {
    panel.insertAdjacentHTML('beforeend',button('commerce-payout',t('commerce.payout'),'secondary'));
    by('commerce-payout').onclick=async()=>{
      if (!await confirmAction({title:t('commerce.payout'),message:money(data.earned),accept:t('commerce.payout')})) return;
      try { await dispatch('payout'); if (view.active()) nav.show(); } catch(error) { toast(failure(error)); }
    };
  }
}
