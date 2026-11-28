import assert from 'node:assert/strict';
import { waterParking, waterRating } from '../../app/src/main/assets/water-community.js';

// The phone's default locale can differ from the app language. Check the rendered score on both community surfaces.
export async function run({ check, locale, words }) {
  const water = { id: 'water', key: 'fixture:water' },
    host = document.querySelector('#screen');
  for (const votes of [0, 2])
    for (const mine of votes ? [null, 1, 5] : [null]) {
      await check(`water/${votes}/${mine}`, async () => {
        window.Device.profileRequest = (id, op, body) => {
          assert.equal(op, 'water_rating');
          assert.deepEqual(JSON.parse(body), { water_key: water.key });
          window.profileReply(id, 200, { count: votes, average: votes ? 3.5 : null, mine });
        };
        await waterRating(host, water);
        const status = votes
          ? `${(3.5).toLocaleString(locale)} / 5 · ${words('common.ratings')} ${votes}`
          : words('common.no_ratings_yet');
        assert.equal(host.querySelector('[role=status]').textContent, status);
        assert.equal(host.querySelector('select').value, String(mine ?? ''));
        assert.equal(!!host.querySelector('#clear-stars'), mine !== null);
        assert.equal(host.querySelector('#save-stars').disabled, true);
        host.querySelector('select').value = '3';
        host.querySelector('select').dispatchEvent(new Event('change'));
        assert.equal(host.querySelector('#save-stars').disabled, false);
      });
    }
  for (const canEdit of [false, true])
    for (const votes of [0, 2])
      await check(`parking/${canEdit}/${votes}`, async () => {
        const row = {
          id: 'point',
          name: 'Parking',
          lat: 49,
          lon: 14,
          average: 3.5,
          votes,
          notes: 1,
          canEdit,
        };
        window.Device.profileRequest = (id, op) => {
          assert.equal(op, 'parking_list');
          window.profileReply(id, 200, { points: [row] });
        };
        const destinations = [],
          directions = [];
        window.Device.driveToParking = (...args) => directions.push(args);
        await waterParking(host, water, { open: (...args) => destinations.push(args) });
        const expected = votes
          ? `${(3.5).toLocaleString(locale)} / 5 · ${words('common.ratings')} ${votes}`
          : words('common.no_ratings_yet');
        const card = host.querySelector('.parking-card');
        assert.ok(card);
        assert.ok(card.textContent.includes(expected));
        card.querySelector('#drive-0').click();
        assert.deepEqual(directions, [[49, 14]]);
        const edit = card.querySelector('#edit-0');
        assert.equal(!!edit, canEdit);
        if (canEdit) {
          edit.click();
          assert.equal(destinations[0][0], 'parkingEditor');
          assert.equal(destinations[0][1].parking.id, 'point');
        }
      });
}
