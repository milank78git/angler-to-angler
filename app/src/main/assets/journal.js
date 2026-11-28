/** Create an identifier for a new private record or a retryable write before contacting a service. */
export const newJournalId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Opens the journal lazily and preserves existing diary records during upgrades. The atlas can run independently of this database. */
export function createJournal(factory = globalThis.indexedDB, name = 'angler-field-journal') {
  let connection;

  /** Share the pending database connection and reopen it after a close, upgrade or failed open. */
  function open() {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const req = factory.open(name, 2);
      req.onupgradeneeded = (event) => {
        req.result.createObjectStore('fingerprints');
        if (event.oldVersion >= 1) return;
        const trips = req.result.createObjectStore('trips', { keyPath: 'id' });
        trips.createIndex('day', 'day');
        const catches = req.result.createObjectStore('catches', { keyPath: 'id' });
        catches.createIndex('tripId', 'tripId');
        req.result.createObjectStore('photos');
      };
      req.onsuccess = () => {
        const db = req.result;
        const opened = connection;
        /** Release the cached connection only if it still refers to the database that closed. */
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

  /** Return the request result only after the readonly transaction completes. */
  function read(store, query) {
    return transaction([store], 'readonly', (tx, result) => {
      const request = query(tx.objectStore(store));
      request.onsuccess = () => result(request.result);
    });
  }

  // Invalidate in the same transaction as the edit, including writes from another WebView.
  function invalidate(tx, key) {
    tx.objectStore('fingerprints').put({ version: newJournalId() }, key);
  }

  // A slow encoder cannot cache old photo hashes over a concurrent write.
  function cacheHashes(key, version, hashes, detached = false) {
    return transaction(['fingerprints'], 'readwrite', (tx, result) => {
      const store = tx.objectStore('fingerprints');
      const current = store.get(key);
      current.onsuccess = () => {
        const unchanged = current.result?.version === version;
        if (unchanged) store.put({ version, hashes, detached }, key);
        result(unchanged);
      };
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
  function saveCatch(record, photo, original) {
    return transaction(['trips', 'catches', 'photos', 'fingerprints'], 'readwrite', (tx) => {
      const parent = tx.objectStore('trips').get(record.tripId);
      parent.onsuccess = () => {
        if (!parent.result) {
          tx.abort();
          return;
        }
        const photos = tx.objectStore('photos');
        const catches = tx.objectStore('catches');
        const previous = catches.get(record.id);
        previous.onsuccess = () => {
          if (original && JSON.stringify(previous.result) !== JSON.stringify(original)) {
            tx.abort();
            return;
          }
          const keepPhoto = original && photo === undefined;
          const next = { ...record, hasPhoto: keepPhoto ? !!previous.result.hasPhoto : !!photo };
          if (!keepPhoto) delete next.cloudPhotoHash;
          catches.put(next);
          if (!keepPhoto) {
            if (photo) photos.put(photo, record.id);
            else photos.delete(record.id);
          }
          if (previous.result && previous.result.tripId !== record.tripId)
            invalidate(tx, 'trip/' + previous.result.tripId);
        };
        invalidate(tx, 'trip/' + record.tripId);
      };
    });
  }

  /** Cascade through the trip index so a retry also removes any associated image. */
  function removeTrip(id) {
    return transaction(['trips', 'catches', 'photos', 'fingerprints'], 'readwrite', (tx) => {
      invalidate(tx, 'trip/' + id);
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
  /** Serialize journal writers across tabs when the browser supplies the Web Locks API. */
  const lock = (operation) =>
    globalThis.navigator?.locks ? navigator.locks.request(name + ':write', operation) : operation();
  /** Notify journal observers only after the underlying write has completed successfully. */
  const change =
    (operation) =>
    (...args) =>
      lock(async () => {
        const result = await operation(...args);
        globalThis.dispatchEvent?.(new Event('journal-edited'));
        return result;
      });

  // Replace all members of a remote trip in one IndexedDB transaction.
  function restoreTrip(id, document, expected = undefined) {
    return transaction(['trips', 'catches', 'photos', 'fingerprints'], 'readwrite', (tx, result) => {
      const key = 'trip/' + id;
      const current = tx.objectStore('fingerprints').get(key);
      current.onsuccess = () => {
        if (expected && current.result?.version !== expected.version) {
          result(false);
          return;
        }
        result(true);
        invalidate(tx, key);
        const trips = tx.objectStore('trips'),
          catches = tx.objectStore('catches'),
          photos = tx.objectStore('photos');
        const previous = catches.index('tripId').getAllKeys(id);
        previous.onsuccess = () => {
          for (const key of previous.result) {
            catches.delete(key);
            photos.delete(key);
          }
          if (!document) {
            trips.delete(id);
            return;
          }
          trips.put(document.trip);
          for (const { record, photo } of document.catches) {
            const found = catches.get(record.id);
            found.onsuccess = () => {
              if (found.result && found.result.tripId !== id) {
                tx.abort();
                return;
              }
              catches.put(record);
              if (photo) photos.put(photo, record.id);
            };
          }
        };
      };
    });
  }
  /** Change the water-specific photo and its sync fingerprint in the same transaction. */
  function writeWaterPhoto(key, blob) {
    return transaction(['photos', 'fingerprints'], 'readwrite', (tx) => {
      invalidate(tx, 'photo/' + key);
      const store = tx.objectStore('photos'),
        id = ['water', key];
      if (blob) store.put(blob, id);
      else store.delete(id);
    });
  }
  return {
    lock,
    restoreTrip,
    writeWaterPhoto,
    installCloudPhoto: (record, photo) =>
      transaction(['photos', 'catches', 'fingerprints'], 'readwrite', (tx) => {
        const catches = tx.objectStore('catches');
        const request = catches.get(record.id);
        request.onsuccess = () => {
          const current = request.result;
          if (
            current &&
            !current.hasPhoto &&
            current.tripId === record.tripId &&
            current.cloudPhotoHash === record.cloudPhotoHash
          ) {
            invalidate(tx, 'trip/' + current.tripId);
            tx.objectStore('photos').put(photo, record.id);
            catches.put({ ...current, hasPhoto: true });
          }
        };
      }),
    cacheHashes,
    fingerprint: (key) => read('fingerprints', (store) => store.get(key)),
    tripKeys: () => read('trips', (store) => store.getAllKeys()),
    waterPhotoKeys: () =>
      read('photos', (store) => store.getAllKeys(IDBKeyRange.bound(['water'], ['water', []]))),
    listTrips,
    statEntries: () =>
      transaction(['trips', 'catches'], 'readonly', (tx, result) => {
        const snapshot = {};
        for (const name of ['trips', 'catches']) {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => {
            snapshot[name] = request.result;
          };
        }
        result(snapshot);
      }),
    saveCatch: change(saveCatch),
    removeTrip: change(removeTrip),
    removeCatch: change((tripId, id) =>
      transaction(['catches', 'photos', 'fingerprints'], 'readwrite', (tx) => {
        const store = tx.objectStore('catches');
        const match = store.get(id);
        match.onsuccess = () => {
          if (match.result?.tripId !== tripId) return;
          store.delete(id);
          tx.objectStore('photos').delete(id);
          invalidate(tx, 'trip/' + tripId);
        };
      }),
    ),
    trip: (id) => read('trips', (s) => s.get(id)),
    catchById: (id) => read('catches', (store) => store.get(id)),
    catches: (id) => read('catches', (s) => s.index('tripId').getAll(id)),
    photo: (id) => read('photos', (s) => s.get(id)),
    // Array keys cannot collide with the string catch IDs in existing journals.
    waterPhoto: (key) => read('photos', (store) => store.get(['water', key])),
    setWaterPhoto: change(writeWaterPhoto),
    saveTrip: change((trip, original) =>
      transaction(['trips', 'fingerprints'], 'readwrite', (tx) => {
        invalidate(tx, 'trip/' + trip.id);
        const store = tx.objectStore('trips');
        if (!original) {
          store.put(trip);
          return;
        }
        const prior = store.get(trip.id);
        prior.onsuccess = () => {
          if (JSON.stringify(prior.result) !== JSON.stringify(original)) tx.abort();
          else store.put(trip);
        };
      }),
    ),
  };
}
export const Journal = createJournal(globalThis.indexedDB, globalThis.Device?.journalName?.());
