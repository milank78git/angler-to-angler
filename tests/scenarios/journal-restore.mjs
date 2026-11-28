import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createJournal} from '../../app/src/main/assets/journal.js';
import {prepareRestore} from '../../app/src/main/assets/journal-transfer.js';

// Two devices share one storage engine. Read back through a third connection after an optimistic restore.
export async function run({check}) {
  for (const before of ['no-entry','text','photo']) for (const after of ['delete-trip','no-entry','text','photo']) {
    for (const intervening of ['none','edit-trip','add-catch','delete-trip','edit-other-trip']) {
      await check(`${before}/${after}/${intervening}`, async () => {
        const storage = new IDBFactory(), db = createJournal(storage), other = createJournal(storage);
        const localTrip = {id:'trip',note:'original'}, remoteTrip = {id:'trip',note:'restored'};
        const record = {id:'fish',tripId:'trip',speciesName:'Pike'};
        await db.saveTrip(localTrip);
        await db.saveTrip({id:'other'});
        if (before !== 'no-entry') await db.saveCatch(record, before === 'photo' ? new Blob(['local']) : null);
        const version = await db.fingerprint('trip/trip');
        const remoteRecord = {...record, speciesName:'Perch',hasPhoto:after === 'photo'};
        const value = after === 'delete-trip' ? null : {trip:remoteTrip, catches:after === 'no-entry' ? [] : [
          {record:remoteRecord,photo:after === 'photo' ? {type:'image/jpeg',data:btoa('restored')} : null},
        ]};
        const apply = await prepareRestore(db, localStorage, 'owner', 'trip/trip', value);
        if (intervening === 'edit-trip') await other.saveTrip({...localTrip,note:'new edit'}, localTrip);
        if (intervening === 'add-catch') await other.saveCatch({id:'later',tripId:'trip'}, null);
        if (intervening === 'delete-trip') await other.removeTrip('trip');
        if (intervening === 'edit-other-trip') await other.saveTrip({id:'other',note:'independent'});
        const accepted = ['none','edit-other-trip'].includes(intervening);
        assert.equal(await apply(version), accepted);
        const reader = createJournal(storage);
        const trip = await reader.trip('trip'), catches = await reader.catches('trip');
        const expectedTrip = accepted ? (value?.trip ?? undefined) : intervening === 'delete-trip' ? undefined
          : intervening === 'edit-trip' ? {...localTrip,note:'new edit'} : localTrip;
        assert.deepEqual(trip, expectedTrip);
        const ids = [], kept = accepted ? ['text','photo'].includes(after) : !!trip && before !== 'no-entry';
        if (kept) ids.push('fish');
        if (intervening === 'add-catch') ids.push('later');
        assert.deepEqual(catches.map(c => c.id), ids);
        if (kept) assert.equal(catches[0].speciesName, accepted ? 'Perch' : 'Pike');
        const expectedPhoto = accepted ? (after === 'photo' ? 'restored' : undefined)
          : (trip && before === 'photo' ? 'local' : undefined);
        assert.equal(await (await reader.photo('fish'))?.text(), expectedPhoto);
        assert.deepEqual(await reader.trip('other'), intervening === 'edit-other-trip' ? {id:'other',note:'independent'} : {id:'other'});
      });
    }
  }
}
