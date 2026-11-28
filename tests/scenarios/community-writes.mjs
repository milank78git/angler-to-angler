import assert from 'node:assert/strict';
import { waterReports } from '../../app/src/main/assets/water-reports.js';
import { purchaseRating, bindPurchaseRating, authorRating } from '../../app/src/main/assets/tip-ratings.js';
import { replaceMarkup } from '../../app/src/main/assets/markup.js';

const criteria = ['accuracy', 'technique', 'match'];
const dialog = () => document.getElementById('confirmation');
function decide(accept) {
  document.getElementById(accept ? 'confirmation-accept' : 'confirmation-cancel').click();
}

export async function run({ check, locale, words }) {
  const host = document.getElementById('screen');
  for (const accuracy of [1, 2, 3, 4, 5])
    for (const technique of [1, 2, 3, 4, 5])
      for (const match of [1, 2, 3, 4, 5]) {
        // Render once per score triple. Cancelling keeps the same draft available for the next confirmation.
        replaceMarkup(host, purchaseRating({ purchased: true, myRating: null }));
        const sent = [],
          shown = [],
          view = { active: () => true, dirty: true };
        window.Device.profileRequest = (id, op, args) => {
          sent.push([op, JSON.parse(args)]);
          window.profileReply(id, 200, {});
        };
        bindPurchaseRating(view, { show: () => shown.push(true) }, 'offer');
        const form = document.getElementById('rating-form'),
          scores = [accuracy, technique, match];
        for (const [index, name] of criteria.entries())
          form.querySelector(`[name="${name}"][value="${scores[index]}"]`).checked = true;
        for (const accept of [false, true])
          await check(`rate/${scores.join('-')}/${accept ? 'submit' : 'cancel'}`, async () => {
            const pending = form.onsubmit(new Event('submit', { cancelable: true }));
            assert.ok(dialog().open);
            const expected = [
              'tip_ratings.accuracy_of_information',
              'tip_ratings.technique_description',
              'tip_ratings.did_the_tip_deliver_what_the_author',
            ];
            const confirmation = document.getElementById('confirmation-message').textContent;
            expected.forEach((key, i) => assert.ok(confirmation.includes(`${words(key)} ${scores[i]}/5`)));
            decide(accept);
            await pending;
            assert.deepEqual(
              sent,
              accept
                ? [['market_rate', { offer_id: 'offer', accuracy, technique, preview_match: match }]]
                : [],
            );
            assert.equal(view.dirty, !accept);
            assert.equal(shown.length, Number(accept));
          });
      }
  for (const detailed of [true, false])
    for (const count of [0, 2])
      await check(`author-summary/${count}/${detailed}`, () => {
        replaceMarkup(
          host,
          authorRating({ count, average: 3.5, accuracy: 4, technique: 2.5, match: 4 }, detailed),
        );
        assert.ok(
          host.textContent.includes(count ? (3.5).toLocaleString(locale) : words('common.no_ratings_yet')),
        );
        assert.equal(host.querySelectorAll('dt').length, count && detailed ? 3 : 0);
      });
  for (const kind of ['low_water', 'fish_deaths', 'closure'])
    for (const count of [0, 1, 2, 3]) {
      for (const mine of count ? [false, true] : [false])
        for (const outcome of ['cancel', 'commit', 'lost-before', 'lost-after', 'limited']) {
          await check(`observation/${kind}/${count}/${mine}/${outcome}`, async () => {
            let owns = mine,
              total = count,
              writes = 0,
              reads = 0;
            window.Device.profileRequest = (id, op, payload) => {
              const args = JSON.parse(payload);
              if (op === 'water_alerts') {
                reads++;
                assert.deepEqual(args, { water_key: 'CZ:pond' });
                window.profileReply(id, 200, { [kind]: { count: total, mine: owns } });
                return;
              }
              writes++;
              assert.equal(op, 'water_report');
              assert.deepEqual(args, { water_key: 'CZ:pond', kind, withdraw: mine });
              if (outcome === 'commit' || outcome === 'lost-after') {
                owns = !mine;
                total += mine ? -1 : 1;
              }
              window.profileReply(id, outcome === 'limited' ? 429 : outcome === 'commit' ? 200 : 503, {});
            };
            await waterReports(host, 'CZ:pond', { active: () => true });
            const row = document.getElementById('report-' + kind).parentNode;
            const action = row.querySelector(':scope > button');
            assert.equal(row.classList.contains('water-alert'), count >= 3);
            assert.equal(
              action.textContent,
              words(mine ? 'water_reports.withdraw_report' : 'water_reports.report_my_observation'),
            );
            const pending = action.onclick();
            decide(outcome !== 'cancel');
            await pending;
            if (outcome.startsWith('lost-')) {
              assert.equal(action.disabled, true);
              const refresh = row.querySelector('[role="status"] + button');
              assert.equal(refresh.hidden, false);
              await refresh.onclick();
              assert.equal(
                host.querySelector('[role=status]').textContent,
                words(owns ? 'water_reports.own_report_active' : 'water_reports.no_own_report'),
              );
            } else if (outcome === 'limited')
              assert.equal(host.querySelector('[role=status]').textContent, words('limits.hourly'));
            assert.equal(reads, ['cancel', 'limited'].includes(outcome) ? 1 : 2);
            assert.equal(writes, Number(outcome !== 'cancel'));
            assert.equal(action.disabled, false);
            assert.equal(row.classList.contains('water-alert'), total >= 3);
          });
        }
    }
}
