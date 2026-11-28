import assert from 'node:assert/strict';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Journal } from '../../app/src/main/assets/journal.js';
import { discussionComposer } from '../../app/src/main/assets/discussion.js';
import { publicCardEditor } from '../../app/src/main/assets/public-cards.js';
import { addVerificationAction } from '../../app/src/main/assets/verification.js';
import { shareCard } from '../../app/src/main/assets/share-card.js';
import { journalStatistics, personalTotals } from '../../app/src/main/assets/journal-statistics.js';
import { bindSharedSpecies } from '../../app/src/main/assets/shared-species.js';
import {
  commerceDiscover,
  commercePublish,
  commerceBuy,
  enrollment,
} from '../../app/src/main/assets/commerce.js';
import { profileDetailsSummary } from '../../app/src/main/assets/angler-details.js';
import { replaceMarkup } from '../../app/src/main/assets/markup.js';
import { emptyState } from '../../app/src/main/assets/ui.js';

const by = (id) => document.getElementById(id);
const confirm = (yes) => by(yes ? 'confirmation-accept' : 'confirmation-cancel').click();
async function until(ready) {
  const deadline = Date.now() + 3000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, 'The view did not render the expected control');
    await yieldTurn();
  }
}
export async function run({ check, words, locale, json }) {
  const site = { id: 'pond', key: 'CZ:pond', country: 'CZ', name: 'Fixture pond', zone: 'Europe/Prague' };
  const pack = json('catalog.json'),
    waterDirectory = { byId: new Map([[site.id, site]]), byKey: new Map([[site.key, site]]) };
  const trip = {
    id: 'member-trip',
    waterId: 'pond',
    country: 'CZ',
    day: '2028-02-29',
    zone: site.zone,
    note: 'private-trip-marker',
  };
  const entry = {
    id: 'member-fish',
    tripId: trip.id,
    speciesName: 'Fixture fish',
    speciesLatin: 'Esox lucius',
    note: 'private-catch-marker',
  };
  await Journal.saveTrip(trip);
  await Journal.saveCatch(entry);
  const host = by('screen');
  const viewFor = (route) => ({ route, active: () => true });
  try {
    for (const mode of ['post', 'answer', 'reply'])
      for (const action of ['blank', 'cancel', 'send', 'wrong-id', 'retry']) {
        await check('discussion/' + mode + '/' + action, async () => {
          const route = {
            id: site.id,
            questionId: mode === 'post' ? null : 'question',
            replyToId: mode === 'reply' ? 'answer' : null,
          };
          const view = viewFor(route),
            calls = [],
            moved = [];
          let reply = action;
          window.Device.profileRequest = (id, op, raw) => {
            const args = JSON.parse(raw);
            calls.push([op, args]);
            window.profileReply(id, reply === 'retry' ? 503 : 200, {
              id: reply === 'wrong-id' ? 'wrong' : args.request_id,
            });
          };
          discussionComposer({ view, nav: { back: () => moved.push(true) }, waterDirectory });
          const input = by('discussion-text'),
            form = by('discussion-form');
          input.value = action === 'blank' ? ' ' : '  Seen here  ';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const submit = () => form.onsubmit(new Event('submit', { cancelable: true }));
          const first = submit();
          if (action !== 'blank') confirm(action !== 'cancel');
          await first;
          if (action === 'blank' || action === 'cancel') {
            assert.equal(calls.length, 0);
            assert.equal(view.dirty, true);
            assert.equal(moved.length, 0);
            return;
          }
          assert.equal(calls[0][0], mode === 'reply' ? 'discussion_reply' : 'discussion_post');
          const args = calls[0][1];
          assert.equal(args.water_key, site.key);
          assert.equal(args.question_id, route.questionId);
          assert.equal(args.reply_to_id, route.replyToId ?? undefined);
          assert.equal(args.message, 'Seen here');
          if (action === 'wrong-id' || action === 'retry') {
            assert.equal(moved.length, 0);
            assert.equal(view.dirty, true);
            assert.ok(by('discussion-error').textContent);
            reply = 'send';
            const second = submit();
            confirm(true);
            await second;
            assert.deepEqual(calls[1], calls[0]);
          }
          assert.deepEqual(moved, [true]);
          assert.equal(view.dirty, false);
        });
      }
    for (const eligible of ['none', 'own', 'other-day', 'already-submitted']) {
      await check('review/' + eligible, async () => {
        const row = document.createElement('article'),
          opened = [],
          reads = [];
        const capture =
          eligible === 'none'
            ? null
            : { captured: eligible === 'other-day' ? '2028-03-01T12:00:00Z' : '2028-02-29T12:00:00Z' };
        const record = { ...entry, hasPhoto: eligible !== 'own', capture };
        window.Device.profileRequest = (id, op, raw) => {
          reads.push([op, JSON.parse(raw)]);
          window.profileReply(id, 200, { items: [{ id: entry.id }] });
        };
        addVerificationAction(row, record, trip, viewFor({}), { open: (...args) => opened.push(args) });
        if (eligible === 'already-submitted') {
          await row.querySelector('button').onclick();
          assert.deepEqual(opened, [['evidence', { onlyId: entry.id }]]);
          assert.equal(reads.length, 1);
          assert.equal(reads[0][1].only_id, entry.id);
        } else {
          assert.equal(row.querySelector('button'), null);
          assert.equal(row.textContent, words('verification.photo_not_reviewed'));
          assert.equal(reads.length, 0);
        }
      });
    }
    for (const water of [null, 'Shared pond'])
      for (const day of [false, true]) {
        await check('public-editor/' + Boolean(water) + '/' + day, async () => {
          window.Device.profileRequest = (id, op, raw) => {
            assert.equal(op, 'public_card_options');
            assert.deepEqual(JSON.parse(raw), { catch_id: entry.id, water_key: site.key });
            window.profileReply(id, 200, { name: 'Angler', water });
          };
          await publicCardEditor({
            view: viewFor({ tripId: trip.id, catchId: entry.id }),
            nav: {},
            pack,
            waterDirectory,
          });
          assert.equal(Boolean(by('public-water')), Boolean(water));
          assert.equal(by('public-day').checked, false);
          if (water) {
            assert.equal(by('public-water').checked, false);
            by('public-water').click();
          }
          if (day) by('public-day').click();
          const preview = by('public-preview');
          assert.equal(preview.querySelector('time').dateTime, day ? trip.day : '2028-02');
          assert.equal(preview.textContent.includes('Shared pond'), Boolean(water));
          assert.doesNotMatch(preview.textContent, /private-trip-marker|private-catch-marker/);
        });
      }
    for (const allowed of [true, false])
      for (const draft of ['', 'Share this tip']) {
        await check('group-tip/' + allowed + '/' + Boolean(draft), async () => {
          const reads = [],
            writes = [],
            saved = [];
          window.Device.profileRequest = (id, op, raw) => {
            if (op === 'groups') {
              reads.push(op);
              return window.profileReply(id, 200, {
                groups: [{ id: 'team', name: 'Team', canShareTip: allowed }],
              });
            }
            const args = JSON.parse(raw);
            writes.push(args);
            assert.equal(op, 'group_tip_post');
            window.profileReply(id, 200, { id: args.request_id });
          };
          await shareCard({
            view: viewFor({ tripId: trip.id }),
            nav: { journalAfterWrite: (id) => saved.push(id) },
            pack,
          });
          by('share-tip-text').value = draft;
          by('share-tip-text').dispatchEvent(new Event('input'));
          assert.equal(by('tip-groups').disabled, !draft);
          assert.equal(by('tip-post').disabled, true);
          if (!draft) {
            assert.equal(reads.length, 0);
            return;
          }
          await by('tip-groups').onclick();
          assert.equal(by('tip-destination').hidden, !allowed);
          assert.equal(writes.length, 0);
          if (!allowed) {
            assert.equal(by('tip-group').options.length, 1);
            return;
          }
          by('tip-group').value = 'team';
          by('tip-group').dispatchEvent(new Event('change'));
          await by('tip-post').onclick();
          assert.equal(writes.length, 1);
          assert.equal(writes[0].group_id, 'team');
          assert.equal(writes[0].message, draft);
          assert.ok(writes[0].request_id);
          assert.deepEqual(saved, [trip.id]);
        });
      }
    await check('statistics/restored-names-and-locale-ties', () => {
      const names = ['Chester', 'Hamilton', 'Island', 'Oland'];
      const trips = [
        ...names.map((waterName) => ({ waterName })),
        { waterId: 'Lake 7', country: 'CZ' },
        { id: 'no-water' },
      ];
      const ranked = personalTotals(trips, [], pack, null);
      const expected = [...names, 'Lake 7'].sort(new Intl.Collator(locale).compare);
      assert.deepEqual(
        ranked.waters,
        expected.map((label) => ({ label, count: 1 })),
      );
    });
    for (const result of [['top_waters'], ['top_species'], []]) {
      await check('statistics/' + (result[0] || 'both'), async () => {
        const reads = [];
        window.Device.profileRequest = (id, op) => {
          reads.push(op);
          window.profileReply(id, result.includes(op) ? 503 : 200, {
            month: '2028-02-01',
            waters: [{ water: site.key, visits: 10 }],
            species: [{ latin: 'Fixture species', fish: 17 }],
          });
        };
        await journalStatistics({ view: viewFor({}), nav: {}, pack, waterDirectory });
        assert.ok(host.textContent.includes(words('trips.private_on_this_phone')));
        assert.equal(reads.length, 0);
        const panel = by('community-stats');
        panel.open = true;
        panel.ontoggle();
        await until(() => by('shared-visits').querySelector('h3'));
        assert.equal(by('shared-visits').textContent.includes(site.name), !result.includes('top_waters'));
        assert.equal(
          by('shared-visits').textContent.includes('Fixture species'),
          !result.includes('top_species'),
        );
        assert.equal(Boolean(by('retry-stats')), Boolean(result.length));
        panel.open = false;
      });
    }
    for (const current of [null, { 'Esox lucius': 1 }]) {
      await check('shared-species/' + (current ? 'withdraw' : 'read-private'), async () => {
        const panel = document.createElement('details');
        panel.append(document.createElement('div'));
        host.replaceChildren(panel);
        const writes = [];
        let counts = current;
        window.Device.profileRequest = (id, op, raw) => {
          assert.equal(op, 'trip_species');
          const args = JSON.parse(raw);
          if ('counts' in args) {
            writes.push(args);
            counts = args.counts;
          }
          window.profileReply(id, 200, { version: 4, counts });
        };
        bindSharedSpecies(panel, pack, trip, [entry], { revision: 9, entry: { fish: 1 } });
        panel.open = true;
        panel.ontoggle();
        await until(() => panel.textContent.includes(words('stats.consent')));
        assert.deepEqual(writes, []);
        if (current) {
          const pending = by('withdraw-species').onclick();
          confirm(true);
          await pending;
          assert.deepEqual(writes, [
            { trip_id: trip.id, trip_revision: 9, expected_version: 4, counts: null },
          ]);
        }
        assert.equal(by('withdraw-species'), null);
        panel.open = false;
      });
    }
    for (const details of [{}, { age: 17 }, { expiry: '2028-02-29' }, { age: 48, expiry: '2028-02-29' }]) {
      await check('profile-summary/' + Object.keys(details).join('+'), async () => {
        const text = document.createElement('p');
        text.id = 'private-summary';
        host.replaceChildren(text);
        window.Device.profileRequest = (id, op) => {
          assert.equal(op, 'my_details');
          window.profileReply(id, 200, details);
        };
        await profileDetailsSummary(viewFor({}));
        const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date('2028-02-29T12:00:00Z'),
        );
        assert.equal(
          text.textContent,
          [
            details.age && words('license.age') + ' · ' + details.age,
            details.expiry && words('license.expiry') + ' · ' + date,
          ]
            .filter(Boolean)
            .join(' / '),
        );
      });
    }
    for (const yes of [false, true]) {
      await check('store/enroll/' + yes, async () => {
        replaceMarkup(host, '<button id="commerce-enroll" type="button">Enroll</button>');
        const events = [],
          refreshed = [];
        window.Device.profileRequest = (id, op, raw) => {
          assert.equal(op, 'commerce');
          events.push(JSON.parse(raw));
          window.profileReply(id, 200, { receipt: 'ack' });
        };
        enrollment(
          viewFor({}),
          { show: () => refreshed.push(true) },
          { id: 'offer', revision: 12, price: 100 },
        );
        const pending = by('commerce-enroll').onclick();
        const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'CZK' }).format(59.71);
        assert.ok(by('confirmation').textContent.includes(amount));
        confirm(yes);
        await pending;
        assert.deepEqual(events, yes ? [{ op: 'enroll', args: { offer: 'offer', revision: 12 } }] : []);
        assert.equal(refreshed.length, Number(yes));
      });
    }
    await check('store/offer-revision-and-paid-amount', async () => {
      const events = [];
      window.Device.profileRequest = (id, op, raw) => {
        assert.equal(op, 'commerce');
        events.push(JSON.parse(raw));
        window.profileReply(id, 200, { receipt: events.length });
      };
      const draft = { offer_id: 'offer', expected_revision: 12, draft: { price: 7 } };
      assert.deepEqual(await commercePublish(draft), { receipt: 1 });
      assert.deepEqual(await commerceDiscover(site.key, 'opaque'), { receipt: 2 });
      assert.deepEqual(await commerceBuy('offer', 13, 7, 2), { receipt: 3 });
      assert.deepEqual(events, [
        { op: 'publish', args: draft },
        { op: 'discover', args: { water: site.key, cursor: 'opaque' } },
        { op: 'buy', args: { offer: 'offer', revision: 13, price: 7, paid: 2 } },
      ]);
    });
    for (const body of ['', '<private>']) {
      await check('empty-view/' + Boolean(body), async () => {
        replaceMarkup(host, emptyState('fish-symbol', '<Title>', body));
        assert.equal(host.querySelector('strong').textContent, '<Title>');
        assert.equal(host.querySelector('p')?.textContent ?? '', body);
        assert.equal(host.querySelector('private'), null);
      });
    }
  } finally {
    await Journal.removeTrip(trip.id);
  }
}
