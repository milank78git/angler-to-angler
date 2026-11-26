const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

test('an incomplete thread keeps replies hidden and a successful reload restores the actions', async (t) => {
  const dom = new JSDOM('<main id="screen"></main>');
  global.window = dom.window;
  global.document = dom.window.document;
  t.after(() => { delete global.window; delete global.document; dom.window.close(); });
  let page = {question: null, items: [{id: 'orphan'}]};
  window.Device = {profileRequest(id) { queueMicrotask(() => window.profileReply(id, 200, page)); }};
  const { waterDiscussion } = await import('../app/src/main/assets/discussion.js');
  const ctx = {view: {route: {id: 'w', questionId: 'thread'}, active: () => true}, nav: {},
    waterDirectory: {byId: new Map([['w',{key: 'w', name: 'River'}]])}};
  await waterDiscussion(ctx);
  const by = id => document.getElementById(id);
  assert.equal(by('discussion-tools').hidden, true);
  assert.equal(by('discussion-items').childElementCount, 0);
  assert.equal(by('discussion-retry').hidden, false);
  page = {question: {id: 'thread', body: 'Root', postedAt: new Date().toISOString()}, items: []};
  await by('discussion-retry').onclick();
  assert.equal(by('discussion-tools').hidden, false);
  assert.equal(by('discussion-root').childElementCount, 1);
});
