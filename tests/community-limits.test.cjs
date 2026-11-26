const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('hourly limits and the pending evidence queue remain distinct across the bridge', async () => {
  global.document = { querySelector: () => null };
  global.window = { Device: { profileRequest(id, operation) {
    queueMicrotask(() => window.profileReply(id, 429,
      operation === 'evidence_submit' ? 'pending_review_limit' : null));
  } } };
  const { rpc, failure } = await import('../app/src/main/assets/profile-api.js');
  for (const [method, expected] of [['discussion_post','limits.hourly'],['evidence_submit','verification.queue_full']]) {
    await assert.rejects(rpc(method), error => failure(error) === expected);
  }
});

test('German covers every pilot UI key and keeps message placeholders intact', () => {
  const dict = lang => JSON.parse(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/strings-' + lang + '.json')));
  const en = dict('en'), de = dict('de');
  for (const key of Object.keys(en)) {
    assert.ok(de[key]?.trim(), key);
    if (/^(age\.|group_catch\.|moderation\.|limits\.)/.test(key)) {
      assert.deepEqual((de[key].match(/\{\w+\}/g) || []).sort(), (en[key].match(/\{\w+\}/g) || []).sort(), key);
    }
  }
});
