// Add a valid JPEG comment to the saved fixture, as can occur in a legacy import.
(async () => {
  const id = document.querySelector('[data-share-catch]').dataset.shareCatch;
  const request = indexedDB.open('angler-field-journal', 1);
  const db = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const tx = db.transaction('photos', 'readwrite');
    const images = tx.objectStore('photos');
    const read = images.get(id);
    read.onsuccess = () => {
      const original = read.result;
      const comment = new TextEncoder().encode('private-gps-marker');
      const header = new Uint8Array([0xff, 0xfe, 0, comment.length + 2]);
      images.put(
        new Blob([original.slice(0, 2), header, comment, original.slice(2)], { type: 'image/jpeg' }),
        id,
      );
    };
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    window.photoSeeded = true;
  } finally {
    db.close();
  }
})();
