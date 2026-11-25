export const newJournalId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );

/** Opens the existing v1 journal lazily. The atlas can run independently of this database. */
export function createJournal(factory = globalThis.indexedDB, name = 'angler-field-journal') {
  let connection;

  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        const trips = req.result.createObjectStore('trips', { keyPath: 'id' });
        trips.createIndex('day', 'day');
        const catches = req.result.createObjectStore('catches', { keyPath: 'id' });
        catches.createIndex('tripId', 'tripId');
        req.result.createObjectStore('photos');
      };
      req.onsuccess = () => {
        const db = req.result;
        const opened = connection;
        const forget = () => {
          if (connection === opened) connection = undefined;
        };
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
    return connection;
  }

  /** Resolve only after commit. IDB aborts the entire operation if any request fails. */
  async function transaction(stores, mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error('Journal transaction aborted'));
      try {
        operation(tx, (result) => {
          value = result;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  function read(store, query) {
    return transaction([store], 'readonly', (tx, result) => {
      const request = query(tx.objectStore(store));
      request.onsuccess = () => result(request.result);
    });
  }

  /** Read the trips and their indexed counts from one snapshot without reading catch bodies. */
  function listTrips() {
    return transaction(['trips', 'catches'], 'readonly', (tx, result) => {
      const request = tx.objectStore('trips').getAll();
      request.onsuccess = () => {
        const trips = request.result,
          index = tx.objectStore('catches').index('tripId');
        for (const trip of trips) {
          const count = index.count(trip.id);
          count.onsuccess = () => {
            trip.catchCount = count.result;
          };
        }
        result(trips);
      };
    });
  }

  /** The caller supplies the full replacement record and its optional photo on every save. */
  function saveCatch(record, photo) {
    return transaction(['trips', 'catches', 'photos'], 'readwrite', (tx) => {
      const parent = tx.objectStore('trips').get(record.tripId);
      parent.onsuccess = () => {
        if (!parent.result) {
          tx.abort();
          return;
        }
        const photos = tx.objectStore('photos');
        tx.objectStore('catches').put({ ...record, hasPhoto: !!photo });
        if (photo) photos.put(photo, record.id);
        else photos.delete(record.id);
      };
    });
  }

  /** Cascade through the trip index so a retry also removes any associated image. */
  function removeTrip(id) {
    return transaction(['trips', 'catches', 'photos'], 'readwrite', (tx) => {
      tx.objectStore('trips').delete(id);
      const matches = tx.objectStore('catches').index('tripId').openKeyCursor(id);
      matches.onsuccess = () => {
        const cursor = matches.result;
        if (!cursor) return;
        tx.objectStore('photos').delete(cursor.primaryKey);
        tx.objectStore('catches').delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  }
  const lock = operation => globalThis.navigator?.locks
    ? navigator.locks.request(name + ':write', operation) : operation();
  const change = operation => (...args) => lock(async () => {
    const result = await operation(...args);
    globalThis.dispatchEvent?.(new Event('journal-edited'));
    return result;
  });

  // Replace all members of a remote trip in one IndexedDB transaction.
  function restoreTrip(id, document) {
    return transaction(['trips','catches','photos'], 'readwrite', tx => {
      const trips = tx.objectStore('trips'), catches = tx.objectStore('catches'), photos = tx.objectStore('photos');
      const previous = catches.index('tripId').getAllKeys(id);
      previous.onsuccess = () => {
        for (const key of previous.result) { catches.delete(key); photos.delete(key); }
        if (!document) { trips.delete(id); return; }
        trips.put(document.trip);
        for (const { record, photo } of document.catches) {
          const found = catches.get(record.id);
          found.onsuccess = () => {
            if (found.result && found.result.tripId !== id) { tx.abort(); return; }
            catches.put(record);
            if (photo) photos.put(photo, record.id);
          };
        }
      };
    });
  }
  function writeWaterPhoto(key, blob) {
    return transaction(['photos'], 'readwrite', tx => {
      const store = tx.objectStore('photos'), id = ['water', key];
      if (blob) store.put(blob, id);
      else store.delete(id);
    });
  }
  return {
    lock, restoreTrip, writeWaterPhoto,
    waterPhotoKeys: () => read('photos', store => store.getAllKeys(IDBKeyRange.bound(['water'], ['water', []]))),
    listTrips,
    statEntries: () => transaction(['trips','catches'], 'readonly', (tx, result) => {
      const snapshot = {};
      for (const name of ['trips','catches']) {
        const request = tx.objectStore(name).getAll();
        request.onsuccess = () => { snapshot[name] = request.result; };
      }
      result(snapshot);
    }),
    saveCatch: change(saveCatch),
    removeTrip: change(removeTrip),
    trip: (id) => read('trips', (s) => s.get(id)),
    catchById: (id) => read('catches', (store) => store.get(id)),
    catches: (id) => read('catches', (s) => s.index('tripId').getAll(id)),
    photo: (id) => read('photos', (s) => s.get(id)),
    // Array keys cannot collide with the string catch IDs in existing journals.
    waterPhoto: (key) => read('photos', (store) => store.get(['water', key])),
    setWaterPhoto: change(writeWaterPhoto),
    saveTrip: change(trip => transaction(['trips'], 'readwrite', tx => tx.objectStore('trips').put(trip))),
  };
}
export const Journal = createJournal(globalThis.indexedDB,globalThis.Device?.journalName?.());
