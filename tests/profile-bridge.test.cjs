const test = require('node:test');
const assert = require('node:assert/strict');

test('a missing bridge reply expires once and a late response cannot resolve the next request', async t => {
  global.window = new EventTarget();
  global.document = { querySelector: () => null };
  let pending;
  window.Device = { profileRequest(id) { pending = id; } };
  t.after(() => { delete global.window; delete global.document; });
  const { rpc } = await import('../app/src/main/assets/profile-api.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = rpc('missing');
  const expired = pending;
  const rejection = assert.rejects(first, error => error.status === 504);
  t.mock.timers.tick(60000);
  await rejection;
  const next = rpc('profile');
  window.profileReply(expired, 200, { ignored: true });
  window.profileReply(pending, 200, { current: true });
  assert.deepEqual(await next, { current: true });
});
