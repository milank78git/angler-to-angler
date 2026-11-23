// Attach a synthetic device fix to the existing photographed catch in the emulator's journal.
(async () => {
  const open = indexedDB.open(Device.journalName(), 1);
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('catches', 'readwrite');
      const cursor = tx.objectStore('catches').openCursor();
      let seeded = false;
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (!row.value.hasPhoto) {
          row.continue();
          return;
        }
        const captured = Date.now();
        row.update({
          ...row.value,
          capture: { captured, fixed: captured, lat: 5001, lon: 1412, accuracy: 8 },
        });
        seeded = true;
      };
      tx.oncomplete = () => (seeded ? resolve() : reject(Error('Missing photographed catch')));
      tx.onabort = () => reject(tx.error);
    });
    window.confirm = () => true;
    window.evidenceSeeded = true;
  } finally {
    db.close();
  }
})().catch((error) => {
  window.evidenceSeedError = String(error);
});
