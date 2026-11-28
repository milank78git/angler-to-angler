import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';

const offer = {
  id: 'c0a00000-0000-4000-8000-000000000001',
  title: 'The evening drift',
  species: 'Esox lucius',
  author: 'Seller',
  access: 'shore',
  day: '2026-01-15',
  price: 23,
  revision: 1,
  balance: 35,
  limit: 1,
  sold: 0,
};
const by = (id) => document.getElementById(id);

// These changes happen while the buyer is reading the original terms. The reply order is controlled
// at the native boundary so the real navigation, confirmation, locking and refresh handlers run.
export async function purchaseJourneys({ check, words, mounted, tab }) {
  const cases = [
    { id: 'seller-reprices', status: 409, changed: { revision: 2, price: 29 } },
    { id: 'last-copy-sold', status: 409, changed: { sold: 1 } },
    { id: 'balance-spent-elsewhere', status: 402, changed: { balance: 15 } },
    { id: 'seller-withdraws', status: 404, unavailable: true },
  ];
  for (const scenario of cases) {
    await check('market/confirm-then-' + scenario.id, async () => {
      const reads = [],
        buys = [];
      let item = { ...offer },
        missing = false;
      const previousBridge = window.Device.profileRequest;
      window.Device.profileRequest = (id, op, body) => {
        const args = JSON.parse(body);
        const reply = (status, result) => queueMicrotask(() => window.profileReply(id, status, result));
        if (op === 'market_discover')
          return reply(200, {
            items: [offer],
            stats: { offers: 1, authors: 1, sales: 0, ratings: 0 },
            balance: 35,
          });
        if (op === 'market_detail') {
          reads.push(args);
          return reply(missing ? 404 : 200, missing ? {} : { ...item });
        }
        if (op === 'market_buy') {
          buys.push({ id, args });
          return;
        }
        previousBridge(id, op, body);
      };
      try {
        await tab('waters');
        by('home-market').click();
        await mounted('marketShelf');
        by('offer-0').click();
        await mounted('marketDetail');
        by('market-buy').click();
        assert.ok(by('confirmation').open);
        assert.ok(
          by('confirmation-message').textContent.includes(
            words('market.credit_amount').replace('{count}', '23'),
          ),
        );
        assert.equal(buys.length, 0);
        by('confirmation-accept').click();
        await nextTurn();
        assert.deepEqual(
          buys.map((call) => call.args),
          [{ offer_id: offer.id, expected_revision: 1, expected_price: 23 }],
        );
        assert.equal(by('market-buy').disabled, true);
        by('market-buy').click();
        window.handleBack();
        assert.equal(by('screen').dataset.page, 'marketDetail');
        assert.equal(buys.length, 1, 'A pending purchase was submitted twice');

        item = { ...item, ...scenario.changed };
        missing = !!scenario.unavailable;
        window.profileReply(buys[0].id, scenario.status, {});
        await nextTurn();
        await mounted('marketDetail');
        assert.deepEqual(reads, [{ offer_id: offer.id }, { offer_id: offer.id }]);
        assert.equal(by('market-technique'), null);
        assert.equal(buys.length, 1, 'Refresh charged without new consent');

        if (scenario.id === 'seller-reprices') {
          by('market-buy').click();
          const terms = by('confirmation-message').textContent;
          assert.ok(terms.includes(words('market.credit_amount').replace('{count}', '29')));
          assert.ok(!terms.includes(words('market.credit_amount').replace('{count}', '23')));
          by('confirmation-cancel').click();
          await nextTurn();
          assert.equal(buys.length, 1);
          by('market-buy').click();
          by('confirmation-accept').click();
          await nextTurn();
          assert.deepEqual(buys[1].args, { offer_id: offer.id, expected_revision: 2, expected_price: 29 });
          item = { ...item, purchased: true, technique: 'Drift with the current' };
          window.profileReply(buys[1].id, 200, {});
          await nextTurn();
          await mounted('marketDetail');
          assert.equal(by('market-technique').textContent, item.technique);
          assert.equal(by('market-buy'), null);
          assert.equal(buys.length, 2);
        } else {
          assert.equal(by('market-buy'), null);
          const message = {
            'last-copy-sold': words('market.remaining') + '0',
            'balance-spent-elsewhere': words('market.you_have_too_few_test_credits_for'),
            'seller-withdraws': words('market.this_offer_is_no_longer_available'),
          }[scenario.id];
          assert.ok(
            by('screen').textContent.includes(message),
            'Buyer cannot see why the offer is unavailable',
          );
          assert.equal(!!by('market-reload'), missing);
        }
      } finally {
        window.Device.profileRequest = previousBridge;
      }
    });
  }
}
