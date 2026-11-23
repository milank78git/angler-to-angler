const test = require('node:test');
const assert = require('node:assert/strict');

test('only the active GPS request can update its catch, and a manual edit drops device accuracy', async (t) => {
  const elements = new Map();
  const label = { textContent: 'Use current location' };
  const bridge = {
    requests: [],
    cancelled: [],
    location(id) {
      this.requests.push(id);
    },
    cancelLocation(id) {
      this.cancelled.push(id);
    },
  };
  const win = new EventTarget();
  win.Device = bridge;
  global.window = win;
  global.Device = { ...bridge, locale: () => 'en' };
  global.document = { querySelector: () => null, getElementById: (id) => elements.get(id) };
  t.after(() => {
    delete global.window;
    delete global.document;
    delete global.Device;
  });
  const { bindCatchPosition } = await import('../app/src/main/assets/catch-position.js');
  function mount() {
    elements.set('gps', { querySelector: () => label });
    elements.set('lat', { value: '' });
    elements.set('lon', { value: '' });
    elements.set('kind', { value: 'strike' });
    return bindCatchPosition({ dirty: false });
  }
  function locate() {
    elements.get('gps').onclick();
    return bridge.requests.at(-1);
  }
  const fix = { lat: 50, lon: 14, accuracy: 7, time: 100 };
  const deliver = (id) => win.dispatchEvent(new CustomEvent('angler-position', { detail: { id, fix } }));
  const first = mount();
  const old = locate();
  first.dispose();
  const second = mount();
  const active = locate();
  assert.notEqual(old, active);
  deliver(old);
  assert.equal(second.waiting(), true);
  assert.equal(elements.get('lat').value, '');
  deliver(active);
  assert.equal(second.waiting(), false);
  const expected = { ...fix, source: 'device', kind: 'strike' };
  assert.deepEqual(second.read(), expected);
  const refresh = locate();
  elements.get('gps').onclick();
  assert.deepEqual(bridge.cancelled, [old, refresh]);
  assert.deepEqual(second.read(), expected);
  const another = locate();
  elements.get('lon').value = '15.1';
  elements.get('lon').oninput();
  deliver(another);
  assert.equal(second.read().source, 'manual');
  assert.equal(second.read().accuracy, null);
  assert.equal(second.read().lon, 15.1);
  assert.equal(second.waiting(), false);
  second.dispose();
});
