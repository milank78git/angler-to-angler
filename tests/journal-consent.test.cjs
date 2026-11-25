const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

test('a registration default cannot send a pre-existing private journal without a device decision', async t => {
  const account = 'test-owner';
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    get length() { return values.size; },
    key: index => [...values.keys()][index],
  };
  global.window = new EventTarget();
  global.document = Object.assign(new EventTarget(), { querySelector: () => null });
  const writes = [], documents = new Map();
  global.Device = window.Device = {
    subjectId: () => account,
    journalName: () => 'old-installation',
    journalCloudDefault: () => true,
    profileRequest(id, operation, body) {
      const { op, args } = JSON.parse(body);
      let reply = {};
      switch (op) {
        case 'settings': reply = { enabled: true }; break;
        case 'list': reply = { rows: [] }; break;
        case 'missing': reply = { hashes: args.hashes }; break;
        case 'enable': case 'put': case 'save':
          writes.push(op);
          if (op === 'save') documents.set(args.key, args.parts);
          break;
        default: throw Error('Unexpected RPC: ' + op);
      }
      queueMicrotask(() => window.profileReply(id, 200, reply));
    }
  };
  const { Journal } = await import('../app/src/main/assets/journal.js');
  await Journal.saveTrip({ id: 'historical', day: '2025-07-01', notes: 'Private trip' });
  // Drive the production scheduler explicitly, including overlapping startup and connectivity checks.
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  await import('../app/src/main/assets/journal-sync.js');
  window.dispatchEvent(new Event('online'));
  await Journal.lock(() => Journal.listTrips());
  for (let i = 0; i < 20; i++) {
    t.mock.timers.tick(i === 10 ? 60000 : 1000);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(documents.has('trip/historical'), false);
  assert.deepEqual(writes, []);
  assert.notEqual(localStorage.getItem('journal.sync.v1.' + account + '.enabled'), '1');
  assert.ok(await Journal.trip('historical'));
});
