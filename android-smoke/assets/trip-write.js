// Instrument only the disposable test WebView. Exercise the production transaction and error handlers.
(() => {
  const originalPut = IDBObjectStore.prototype.put;
  let released = false;
  window.writeProbe = {
    attempts: 0,
    resume() {
      released = true;
      IDBObjectStore.prototype.put = originalPut;
    },
  };

  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    if (this.name !== 'trips') return request;

    window.writeProbe.attempts++;
    if (window.writeProbe.attempts === 1) {
      this.transaction.abort();
    } else {
      // Keep the second transaction active across native Back without blocking the UI thread.
      const hold = () => {
        if (!released) this.getKey(args[0].id).onsuccess = hold;
      };
      hold();
    }
    return request;
  };
})();
