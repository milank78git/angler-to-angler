import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';

const field = (id) => document.getElementById(id);
const sale = {
  id: 'd0010000-2345-4678-9012-a00000000001',
  title: 'Reed margins',
  author: 'Seller',
  species: 'Esox lucius',
  day: '2025-01-15',
  access: 'shore',
  price: 23,
  revision: 2,
  limit: 1,
  sold: 0,
  commercial: true,
};
const account = {
  mode: 'test',
  enrolled: true,
  balance: 60,
  welcomeBalance: 10,
  earned: 0,
  pendingCredits: 0,
  requested: 0,
  paid: 0,
  published: 0,
};

// Keep the production renderer, validation, navigation and confirmation. Supply the native responses
// at their real boundary and hold writes until the scenario delivers the server's reply.
export async function playMarketJourneys({ check, words, mounted, tab }) {
  async function withMarket(item, wallet, exercise) {
    const bridge = window.Device.profileRequest,
      play = window.PlayMarket;
    const writes = [],
      storePurchases = [],
      legacyWrites = [];
    const reply = (id, status, body) => queueMicrotask(() => window.profileReply(id, status, body));
    window.PlayMarket = {
      refresh() {},
      buy(sku) {
        storePurchases.push(sku);
      },
    };
    window.Device.profileRequest = (id, op, body) => {
      const data = JSON.parse(body);
      if (op === 'market_detail') return reply(id, 200, { ...item });
      if (op === 'market_buy' || op === 'market_publish') legacyWrites.push(op);
      if (op !== 'commerce') return bridge(id, op, body);
      if (data.op === 'status') return reply(id, 200, { ...wallet });
      if (data.op === 'discover')
        return reply(id, 200, {
          items: item ? [item] : [],
          stats: { offers: item ? 1 : 0, authors: item ? 1 : 0, sales: 0, ratings: 0 },
        });
      writes.push({ ...data, reply: (status, result = {}) => reply(id, status, result) });
    };
    try {
      await tab('waters');
      field('home-market').click();
      await mounted('marketShelf');
      await exercise(writes);
      assert.deepEqual(storePurchases, [], 'Using wallet credits unexpectedly launched Play checkout');
      assert.deepEqual(legacyWrites, [], 'Commercial writes entered the pilot wallet');
    } finally {
      await tab('waters');
      window.Device.profileRequest = bridge;
      if (play === undefined) delete window.PlayMarket;
      else window.PlayMarket = play;
    }
  }

  const funding = [
    {
      name: 'limited-stock-requires-paid-credit',
      price: 10,
      balance: 10,
      welcome: 10,
      reason: 'commerce.limited_paid',
    },
    { name: 'unlimited-welcome-only', limit: null, price: 10, balance: 10, welcome: 10, quote: [10, 0] },
    { name: 'last-copy-one-paid-credit', price: 4, balance: 11, welcome: 10, quote: [3, 1] },
    { name: 'mixed-balance-exact-price', price: 23, balance: 23, welcome: 10, quote: [10, 13] },
    { name: 'paid-only-exact-price', price: 23, balance: 23, welcome: 0, quote: [0, 23] },
    {
      name: 'insufficient-by-one-credit',
      price: 23,
      balance: 22,
      welcome: 10,
      reason: 'commerce.insufficient',
    },
    {
      name: 'unenrolled-pilot-listing',
      price: 23,
      balance: 60,
      welcome: 10,
      enrolled: false,
      reason: 'commerce.pilot_offer',
    },
  ];
  for (const example of funding) {
    await check('play/buy/' + example.name, async () => {
      const item = { ...sale, price: example.price, limit: 'limit' in example ? example.limit : 1 };
      const wallet = {
        ...account,
        balance: example.balance,
        welcomeBalance: example.welcome,
        enrolled: example.enrolled ?? true,
      };
      await withMarket(item, wallet, async (writes) => {
        field('offer-0').click();
        await mounted('marketDetail');
        assert.equal(field('market-technique'), null);
        if (example.reason) {
          assert.equal(field('market-buy'), null);
          assert.ok(field('screen').textContent.includes(words(example.reason)));
          assert.equal(writes.length, 0);
          return;
        }
        const [welcome, paid] = example.quote;
        field('market-buy').click();
        const terms = field('confirmation-message').textContent;
        assert.ok(
          terms.includes(
            words('commerce.purchase_funding')
              .replace('{welcome}', String(welcome))
              .replace('{paid}', String(paid)),
          ),
        );
        assert.equal(terms.includes(words('commerce.welcome_access')), paid === 0);
        field('confirmation-cancel').click();
        await nextTurn();
        assert.equal(writes.length, 0);
        field('market-buy').click();
        field('confirmation-accept').click();
        await nextTurn();
        assert.equal(writes.length, 1);
        assert.equal(writes[0].op, 'buy');
        assert.deepEqual(writes[0].args, { offer: item.id, revision: 2, price: item.price, paid });
        assert.equal(field('market-buy').disabled, true);
        assert.equal(field('market-technique'), null);
        Object.assign(item, { purchased: true, technique: 'Follow the near-bank current.' });
        writes[0].reply(200);
        await nextTurn();
        await mounted('marketDetail');
        assert.equal(field('market-technique').textContent, item.technique);
        assert.equal(field('market-buy'), null);
        assert.equal(writes.length, 1);
      });
    });
  }
  await check('play/publish/preview-cancel-uncertain-receipt-and-retry', async () => {
    await withMarket(null, account, async (writes) => {
      field('market-create').click();
      await mounted('marketEditor');
      function enter(id, value) {
        const el = field(id);
        el.value = value;
        assert.equal(el.value, value);
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      }
      const technique = 'Cast along the inner reed edge.';
      enter('offer-title', sale.title);
      enter('offer-country', 'CZ');
      enter('species-filter', sale.species);
      enter('offer-species', sale.species);
      enter('offer-day', sale.day);
      enter('offer-limit', '1');
      enter('offer-technique', technique);
      enter('offer-price', '0');
      field('market-preview').click();
      assert.equal(field('offer-price').validity.rangeUnderflow, true);
      assert.equal(field('confirmation').open, false);
      enter('offer-price', '23');
      field('market-preview').click();
      const summary = field('confirmation-message').textContent;
      for (const expected of [
        sale.title,
        sale.species,
        words('commerce.split'),
        words('market.credit_amount').replace('{count}', '23'),
      ])
        assert.ok(summary.includes(expected));
      assert.ok(!summary.includes(technique));
      field('confirmation-cancel').click();
      await nextTurn();
      assert.equal(writes.length, 0);
      assert.equal(field('offer-technique').value, technique);
      field('market-preview').click();
      field('confirmation-accept').click();
      await nextTurn();
      assert.equal(writes.length, 1);
      assert.equal(field('market-preview').disabled, true);
      assert.equal(writes[0].op, 'publish');
      const request = writes[0].args;
      assert.match(request.offer_id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
      assert.equal(request.expected_revision, 0);
      assert.deepEqual(request.draft, {
        title: sale.title,
        species: sale.species,
        day: sale.day,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        access: 'shore',
        water: null,
        price: 23,
        limit: 1,
        technique,
      });
      writes[0].reply(503);
      await nextTurn();
      assert.equal(field('screen').dataset.page, 'marketEditor');
      assert.equal(field('offer-technique').value, technique);
      field('market-preview').click();
      field('confirmation-accept').click();
      await nextTurn();
      assert.deepEqual(
        writes.map(({ op, args }) => ({ op, args })),
        [
          { op: 'publish', args: request },
          { op: 'publish', args: request },
        ],
      );
      writes[1].reply(200);
      await mounted('marketShelf');
    });
  });
}
