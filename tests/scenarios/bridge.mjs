import assert from 'node:assert/strict';
import { rpc, failure } from '../../app/src/main/assets/profile-api.js';

// Exercise reads that may overlap while a user changes screen. The bridge must correlate replies by ID, even after an error.
const operations = ['my_details', 'market_list', 'activity_state'];
const outcomes = [
  [200],
  [400, 'profile_api.the_details_could_not_be_accepted_check'],
  [401, 'profile_api.sign_in_again_to_use_the_online'],
  [403, 'profile_api.you_do_not_have_access_to_this'],
  [404, 'profile_api.this_profile_is_private_or_no_longer'],
  [409, 'profile_api.the_record_changed_or_the_photo_was'],
  [429, 'limits.hourly'],
  [503, 'profile-api.service.unavailable.check.your.connection.and.retry'],
];
const orders = ['012', '021', '102', '120', '201', '210'];
export async function run({ check, words }) {
  const args = [{}, { shelf: 'mine' }, { trip_id: 'private-trip' }];
  for (const a of outcomes)
    for (const b of outcomes)
      for (const c of outcomes)
        for (const order of orders) {
          const outcomesByRequest = [a, b, c];
          await check(`${outcomesByRequest.map(([status]) => status).join('-')}/${order}`, async () => {
            const sent = new Map(),
              settled = [];
            window.Device.profileRequest = (id, operation, body) => {
              assert.ok(!sent.has(operation));
              sent.set(operation, id);
              assert.deepEqual(JSON.parse(body), args[operations.indexOf(operation)]);
            };
            const waiting = operations.map((op, index) =>
              rpc(op, args[index]).then(
                (value) => {
                  assert.equal(outcomesByRequest[index][0], 200);
                  assert.deepEqual(value, { op });
                  settled.push(index);
                },
                (error) => {
                  const [status, message] = outcomesByRequest[index];
                  assert.equal(error.status, status);
                  assert.deepEqual(error.reason, { op });
                  assert.equal(failure(error), words(message));
                  settled.push(index);
                },
              ),
            );
            assert.equal(new Set(sent.values()).size, operations.length);
            for (const digit of order) {
              const index = Number(digit),
                op = operations[index],
                id = sent.get(op);
              window.profileReply(id, outcomesByRequest[index][0], { op });
              // A duplicate from a retired WebView request cannot claim a still-pending reply.
              window.profileReply(id, 409, { op: 'late reply' });
              await Promise.resolve();
              assert.deepEqual(settled, [...order.slice(0, settled.length)].map(Number));
            }
            await Promise.all(waiting);
            assert.equal(settled.join(''), order);
          });
        }
}
