'use strict';
/** Commits changes and images in one durable IndexedDB transaction. */
const Journal = (() => {
  let db;
  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('angler-field-journal', 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('trips', { keyPath: 'id' });
        store.createIndex('day', 'day');
        const catches = req.result.createObjectStore('catches', { keyPath: 'id' });
        catches.createIndex('tripId', 'tripId');
        req.result.createObjectStore('photos');
      };
      req.onsuccess = () => {
        db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
  function read(store, action) {
    return new Promise((resolve, reject) => {
      const req = action(db.transaction(store).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function write(stores, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('aborted'));
      try {
        action(tx);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }
  function saveCatch(record, photo) {
    return write(['trips', 'catches', 'photos'], (tx) => {
      const parent = tx.objectStore('trips').get(record.tripId);
      parent.onsuccess = () => {
        if (!parent.result) {
          tx.abort();
          return;
        }
        tx.objectStore('catches').put(record);
        if (photo) tx.objectStore('photos').put(photo, record.id);
      };
    });
  }
  function removeTrip(id) {
    return write(['trips', 'catches', 'photos'], (tx) => {
      tx.objectStore('trips').delete(id);
      const matches = tx.objectStore('catches').index('tripId').openCursor(IDBKeyRange.only(id));
      matches.onsuccess = () => {
        const cursor = matches.result;
        if (!cursor) return;
        tx.objectStore('photos').delete(cursor.primaryKey);
        cursor.delete();
        cursor.continue();
      };
    });
  }
  return {
    open,
    trips: () => read('trips', (s) => s.getAll()),
    catches: (id) => read('catches', (s) => s.index('tripId').getAll(id)),
    trip: (id) => read('trips', (s) => s.get(id)),
    photo: (id) => read('photos', (s) => s.get(id)),
    saveTrip: (t) => write(['trips'], (tx) => tx.objectStore('trips').put(t)),
    saveCatch,
    removeTrip,
  };
})();
