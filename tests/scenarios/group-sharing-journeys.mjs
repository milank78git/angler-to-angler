import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Journal } from '../../app/src/main/assets/journal.js';

const by = (id) => document.getElementById(id);
const first = { id: 'group-a', name: 'River group', canShareCatch: true };
const second = { id: 'group-b', name: 'Lake group', canShareCatch: true };
const denied = [
  { id: 'group-c', name: 'Other group', canShareCatch: false },
  { id: 'legacy', name: 'Legacy membership' },
  { id: 'pending', name: 'Pending consent', canShareCatch: null },
];
const trip = {
  id: 'consent-trip',
  day: '2024-05-17',
  waterName: 'Private pond',
  notes: 'Private location notes',
  created: 1,
};
const fish = {
  id: 'consent-catch',
  tripId: trip.id,
  speciesName: 'Field perch',
  lengthMm: 280,
  bait: 'Private bait',
  created: 2,
};

// Start at the home page with the same restriction flag supplied by the Android account bridge.
export async function groupSharingJourneys({ check, words, mounted, tab }) {
  const cases = [
    'no-confirmed-grant',
    'cancel-preview',
    'consent-revoked-before-send',
    'lost-receipt-same-group',
    'change-recipient-after-failure',
  ];
  for (const outcome of cases) {
    await check('group-only/' + outcome, async () => {
      const { groupSharingOnly, profileRequest, shareCatch } = window.Device;
      const attempts = [],
        external = [];
      window.Device.groupSharingOnly = () => true;
      window.Device.shareCatch = (...args) => external.push(args);
      window.Device.profileRequest = (id, op, body) => {
        const reply = (status, data) => queueMicrotask(() => window.profileReply(id, status, data));
        if (op === 'groups')
          return reply(200, {
            groups: outcome === 'no-confirmed-grant' ? denied : [first, ...denied, second],
          });
        if (op === 'group_catch_post') {
          const payload = JSON.parse(body);
          attempts.push(payload);
          if (outcome === 'consent-revoked-before-send') return reply(403, {});
          if (attempts.length === 1) return reply(503, {});
          return reply(200, { id: payload.request_id });
        }
        return profileRequest(id, op, body);
      };
      try {
        await Journal.saveTrip(trip);
        await Journal.saveCatch(fish);
        await tab('waters');
        assert.equal(by('home-market').hidden, true);
        await tab('trips');
        document.querySelector('[data-trip="consent-trip"]').click();
        await mounted('trip');
        assert.equal(document.querySelector('[data-public-catch]'), null);
        assert.equal(by('offer-technique'), null);
        document.querySelector('[data-share-catch="consent-catch"]').click();
        await mounted('shareCard');
        assert.equal(by('card-send'), null);
        const select = by('catch-group'),
          send = by('send-group-catch');
        if (outcome === 'no-confirmed-grant') {
          assert.equal(select, null, 'A group-only account must have an explicit catch-sharing grant');
          assert.equal(send, null);
          assert.ok(by('screen').textContent.includes(words('age.no_permission')));
          return;
        }
        assert.deepEqual(
          [...select.options].map((o) => o.value),
          ['', first.id, second.id],
        );
        assert.equal(send.disabled, true);
        async function review(group, accept) {
          select.value = group.id;
          select.dispatchEvent(new Event('change'));
          send.click();
          assert.ok(by('confirmation').open);
          assert.equal(
            by('confirmation-message').textContent,
            words('age.group_preview').replace('{group}', group.name),
          );
          assert.equal(by('confirmation-species').textContent, fish.speciesName);
          assert.ok(!by('confirmation').textContent.includes('Private'));
          by(accept ? 'confirmation-accept' : 'confirmation-cancel').click();
          await nextTurn();
        }
        await review(first, outcome !== 'cancel-preview');
        if (outcome === 'cancel-preview') {
          assert.deepEqual(attempts, []);
          assert.equal(send.disabled, false);
          return;
        }
        const original = attempts[0];
        assert.match(original.request_id, /^(?:[a-f0-9]{32}|[a-f0-9-]{36})$/i);
        assert.deepEqual(original, {
          request_id: original.request_id,
          group_id: first.id,
          species: fish.speciesName,
          day: trip.day,
          length_mm: 280,
          photo: null,
        });
        assert.equal(by('screen').dataset.page, 'shareCard');
        assert.equal(
          by('notice').textContent,
          words(
            outcome === 'consent-revoked-before-send'
              ? 'profile_api.you_do_not_have_access_to_this'
              : 'profile-api.service.unavailable.check.your.connection.and.retry',
          ),
        );
        if (outcome === 'consent-revoked-before-send') {
          assert.equal(attempts.length, 1);
          return;
        }
        const group = outcome === 'lost-receipt-same-group' ? first : second;
        await review(group, true);
        await mounted('trip');
        assert.equal(attempts.length, 2);
        if (group === first) assert.deepEqual(attempts[1], original);
        else {
          assert.notEqual(attempts[1].request_id, original.request_id);
          assert.deepEqual(attempts[1], {
            ...original,
            request_id: attempts[1].request_id,
            group_id: second.id,
          });
        }
        assert.equal(by('notice').textContent, words('age.shared'));
      } finally {
        Object.assign(window.Device, { groupSharingOnly, profileRequest, shareCatch });
        await tab('trips');
        await Journal.removeTrip(trip.id);
        assert.deepEqual(external, [], 'A group-only share opened the external Android share sheet');
      }
    });
  }
}
