const test = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { createJournal } = require('../app/src/main/assets/journal.js');

test('offline trips, catches and photos are atomic, retryable and readable after reopening', async () => {
  const factory = new IDBFactory();
  let j = createJournal(factory);
  await j.saveTrip({ id: 'empty', day: '2026-11-23' });
  await j.saveTrip({ id: 'river', day: '2026-11-22' });
  const record = {
    id: 'fish-a',
    tripId: 'river',
    lengthMm: 723,
    position: { lat: 49.01, lon: 14.02, source: 'manual' },
  };
  const photo = new Blob(['pixels'], { type: 'image/jpeg' });
  await Promise.all([j.saveCatch(record, photo), j.saveCatch({ id: 'fish-b', tripId: 'river' }, null)]);
  await j.saveCatch(record, photo);
  j = createJournal(factory);
  assert.equal((await j.listTrips()).length, 2);
  assert.equal((await j.catches('empty')).length, 0);
  assert.equal((await j.catches('river')).length, 2);
  assert.equal((await j.catches('river'))[0].position.lon, 14.02);
  assert.equal(await (await j.photo('fish-a')).text(), 'pixels');
  await assert.rejects(() => j.saveCatch({ id: 'orphan', tripId: 'missing' }, photo));
  assert.equal(await j.photo('orphan'), undefined);
  assert.deepEqual(Object.fromEntries((await j.listTrips()).map((trip) => [trip.id, trip.catchCount])), {
    empty: 0,
    river: 2,
  });
  await assert.rejects(j.saveCatch({ ...record, tripId: 'missing' }, null));
  assert.equal(await (await j.photo(record.id)).text(), 'pixels');
  assert.equal((await j.catches('river')).find((c) => c.id === record.id).hasPhoto, true);
  await j.saveCatch(record, null);
  assert.equal(await j.photo(record.id), undefined);
  assert.equal((await j.catches('river')).find((c) => c.id === record.id).hasPhoto, false);
  await j.saveCatch(record, photo);
  await j.removeTrip('river');
  await j.removeTrip('river');
  assert.equal(await j.photo('fish-a'), undefined);
  assert.equal((await j.catches('river')).length, 0);
  assert.equal((await j.listTrips()).length, 1);
});
