const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

test('compact sync summaries preserve recovery, photo reminders and view lifetimes', async t => {
  const { window } = new JSDOM(
    '<button id="journal-sync-toggle">Sync</button>' +
    '<section id="journal-sync-details" aria-labelledby="journal-sync-toggle"><aside></aside></section>' +
    '<button id="elsewhere">Other action</button><aside id="second"></aside>',
    { url: 'https://journal.test' },
  );
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage,
    Event: window.Event, indexedDB: new IDBFactory(), IDBKeyRange,
  });
  const prefix = 'journal.sync.v1.owner.';
  const savedAt = Date.UTC(2026, 10, 28, 10, 40);
  localStorage.setItem(prefix + 'enabled', '1');
  localStorage.setItem(prefix + 'registered', '1');
  localStorage.setItem(prefix + 'lastSuccess', String(savedAt));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async path => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(join(__dirname, '../app/src/main/assets', path), 'utf8')),
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete navigator.onLine;
    window.close();
  });
  const requests = [];
  let pending;
  window.Device = {
    subjectId: () => 'owner',
    profileRequest(id, operation, raw) {
      assert.equal(operation, 'journal_sync');
      const { op } = JSON.parse(raw);
      requests.push(op);
      assert.ok(['list', 'settings'].includes(op), 'Presentation must not add a write operation');
      pending = status => queueMicrotask(() => window.profileReply(id, status, { rows: [], floor: 0 }));
    },
  };
  const { loadDictionary, label, languageTag } = await import('../app/src/main/assets/i18n.js');
  await loadDictionary();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { bindJournalSync } = await import('../app/src/main/assets/journal-sync.js');
  const panel = document.querySelector('aside');
  const states = [];
  const dispose = bindJournalSync(panel, undefined, state => states.push(state));
  const latest = () => states.at(-1);
  const retry = () => panel.querySelector('[data-action="sync.retry"]');
  async function until(predicate) {
    for (let count = 0; count < 3000 && !predicate(); count++)
      await new Promise(resolve => setImmediate(resolve));
    assert.ok(predicate(), 'Expected the synchronization presentation to settle');
  }
  async function reply(status, expected) {
    await until(() => !!pending);
    const complete = pending;
    pending = null;
    complete(status);
    await until(() => latest().state === expected && !!retry());
  }

  assert.deepEqual(latest(), {
    state: 'waiting', label: label('sync.waiting'), notice: '', attention: false, available: true,
  });
  // A collapsed detail panel must still publish a failure above the journal list.
  document.getElementById('journal-sync-details').hidden = true;
  t.mock.timers.tick(701);
  await until(() => !!pending);
  assert.equal(latest().state, 'working');
  assert.equal(latest().attention, false);
  await reply(503, 'failed');
  assert.equal(latest().label, label('sync.failed'));
  assert.equal(latest().notice, label('sync.failed'));
  assert.equal(latest().attention, true);
  assert.ok(panel.querySelector('[data-action="sync.pause"]'));
  assert.ok(panel.querySelector('[data-action="sync.erase"]'));

  for (const [httpStatus, state, key] of [
    [413, 'full', 'sync.full'],
    [429, 'limited', 'limits.hourly'],
    [401, 'signin', 'sync.signin'],
    [403, 'signin', 'sync.signin'],
  ]) {
    retry().click();
    await reply(httpStatus, state);
    assert.equal(latest().notice, label(key));
    assert.equal(latest().attention, true);
  }

  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  window.dispatchEvent(new Event('offline'));
  assert.equal(latest().state, 'offline');
  assert.equal(latest().notice, label('sync.offline'));
  assert.equal(latest().attention, true);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  retry().click();
  await reply(200, 'done');
  assert.equal(latest().attention, false);
  assert.equal(latest().notice, '');
  assert.equal(latest().label, label('sync.saved_at').replace('{time}',
    new Intl.DateTimeFormat(languageTag, { dateStyle: 'short', timeStyle: 'short' }).format(savedAt)));

  // Upcoming cloud-photo expiry remains visible even after an otherwise successful sync.
  localStorage.setItem(prefix + 'photos', JSON.stringify([
    { id: 'soon', trip: 'trip/day', active: true, expires: new Date(Date.now() + 86400000).toISOString() },
    { id: 'later', trip: 'trip/day', active: true, expires: new Date(Date.now() + 31 * 86400000).toISOString() },
    { id: 'expired', trip: 'trip/day', active: true, expires: new Date(Date.now() - 86400000).toISOString() },
  ]));
  window.dispatchEvent(new Event('journal-sync-status'));
  assert.equal(latest().state, 'done');
  assert.equal(latest().notice, label('retention.due').replace('{count}', '1'));
  assert.equal(latest().attention, true);
  assert.equal(panel.querySelectorAll('input[type="checkbox"]').length, 1);
  assert.equal(localStorage.getItem(prefix + 'photoRenewals'), null);
  localStorage.removeItem(prefix + 'photos');

  // Retain the exact action after a status-only refresh, or return to the disclosure while busy.
  const details = document.getElementById('journal-sync-details');
  details.hidden = false;
  panel.querySelector('[data-action="sync.pause"]').focus();
  window.dispatchEvent(new Event('journal-sync-status'));
  await Promise.resolve();
  assert.equal(document.activeElement.dataset.action, 'sync.pause');
  retry().focus();
  retry().click();
  await until(() => !!pending);
  assert.equal(document.activeElement.id, 'journal-sync-toggle');
  await reply(200, 'done');
  retry().focus();
  window.dispatchEvent(new Event('journal-sync-status'));
  document.getElementById('elsewhere').focus();
  await Promise.resolve();
  assert.equal(document.activeElement.id, 'elsewhere');

  const otherStates = [];
  const second = document.getElementById('second');
  const disposeSecond = bindJournalSync(second, undefined, state => otherStates.push(state));
  dispose();
  dispose();
  const count = states.length;
  const otherCount = otherStates.length;
  window.dispatchEvent(new Event('journal-sync-status'));
  assert.equal(states.length, count);
  assert.equal(otherStates.length, otherCount + 1);
  second.remove();
  window.dispatchEvent(new Event('journal-sync-status'));
  window.dispatchEvent(new Event('journal-sync-status'));
  assert.equal(otherStates.length, otherCount + 1);
  disposeSecond();

  // A failed account lookup offers recovery without enabling synchronization by opening its summary.
  window.Device.subjectId = () => 'unchecked';
  const unchecked = await import('../app/src/main/assets/journal-sync.js?unchecked-summary');
  const uncheckedStates = [];
  const disposeUnchecked = unchecked.bindJournalSync(panel, undefined, state => uncheckedStates.push(state));
  assert.equal(uncheckedStates.at(-1).state, 'checking');
  await until(() => !!pending);
  const finishCheck = pending;
  pending = null;
  finishCheck(503);
  await until(() => uncheckedStates.at(-1).state === 'check_failed' && !!retry());
  assert.equal(uncheckedStates.at(-1).attention, true);
  assert.equal(uncheckedStates.at(-1).notice, label('sync.check_failed'));
  assert.ok(panel.querySelector('[data-action="sync.enable"]'));
  disposeUnchecked();

  const requestCount = requests.length;
  for (const [suffix, device, expected] of [
    ['restricted', { subjectId: () => 'child', groupSharingOnly: () => true }, 'age.local_journal'],
    ['signed-out', {}, 'sync.disabled'],
  ]) {
    window.Device = device;
    panel.replaceChildren();
    const unavailable = await import('../app/src/main/assets/journal-sync.js?' + suffix);
    const summaries = [];
    const stop = unavailable.bindJournalSync(panel, undefined, state => summaries.push(state));
    assert.deepEqual(summaries, [{
      state: 'disabled', label: label(expected), notice: '', attention: false, available: false,
    }]);
    assert.equal(panel.querySelector('button'), null);
    if (suffix === 'restricted') assert.equal(panel.textContent, label('age.local_journal'));
    stop();
    stop();
  }
  assert.equal(requests.length, requestCount);
});
