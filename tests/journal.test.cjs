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

test('a transient database opening error can be retried without restarting the app', async () => {
  const factory = new IDBFactory();
  let attempts = 0;
  const journal = createJournal({
    open(...args) {
      if (++attempts === 1) throw new Error('storage unavailable');
      return factory.open(...args);
    },
  });
  await assert.rejects(journal.listTrips(), /storage unavailable/);
  await Promise.all([journal.saveTrip({ id: 'trip' }), journal.listTrips()]);
  assert.equal(attempts, 2);
  assert.deepEqual(await journal.listTrips(), [{ id: 'trip', catchCount: 0 }]);
});

test('journals on one device keep trips, catches and photos scoped to their owner', async () => {
  const factory = new IDBFactory();
  const owner = createJournal(factory, 'angler-field-journal-owner');
  const visitor = createJournal(factory, 'angler-field-journal-visitor');
  await owner.saveTrip({ id: 'river' });
  await owner.saveCatch({ id: 'perch', tripId: 'river' }, new Blob(['private photo']));
  assert.deepEqual(await visitor.listTrips(), []);
  assert.deepEqual(await visitor.catches('river'), []);
  assert.equal(await visitor.photo('perch'), undefined);
  await visitor.removeTrip('river');
  assert.equal(await (await owner.photo('perch')).text(), 'private photo');
});

test('water photographs survive trip deletion and stay isolated by water and device journal', async () => {
  const factory = new IDBFactory(), name = 'first';
  const j = createJournal(factory, name), key = 'CZ:CRS:123';
  const photo = new Blob(['shore'], { type: 'image/jpeg' });
  await j.saveTrip({id:'trip'});
  await j.saveCatch({id:key, tripId:'trip'}, photo);
  await j.setWaterPhoto(key, photo);
  await j.removeTrip('trip');
  assert.equal(await j.photo(key), undefined);
  assert.equal(await (await createJournal(factory, name).waterPhoto(key)).text(), 'shore');
  assert.equal(await j.waterPhoto('CZ:MRS:123'), undefined);
  assert.equal(await createJournal(factory, 'second').waterPhoto(key), undefined);
  await j.setWaterPhoto(key, new Blob(['updated']));
  assert.equal(await (await j.waterPhoto(key)).text(), 'updated');
  await j.setWaterPhoto(key, null);
  assert.equal(await j.waterPhoto(key), undefined);
});
