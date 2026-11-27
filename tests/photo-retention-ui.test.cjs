const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

test('only an intentional detail view or a selected renewal queues a lease, including offline', async () => {
  const { window } = new JSDOM('<article></article><aside></aside>', { url: 'https://example.test' });
  Object.assign(globalThis, {
    window, document: window.document, localStorage: window.localStorage, Image: window.Image,
    Event: window.Event, indexedDB: new IDBFactory(), IDBKeyRange,
  });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  const subject = 'owner';
  window.Device = { subjectId: () => subject };
  const prefix = 'journal.sync.v1.owner.';
  localStorage.setItem(prefix + 'enabled', '1');
  localStorage.setItem(prefix + 'epoch', 'original');
  const { bindCatchPhoto, bindExpirySummary, refreshPhotoLeases, dismissPhotoDetail } =
    require('../app/src/main/assets/photo-retention.js');
  const { photoHash } = require('../app/src/main/assets/journal-photos.js');
  const image = new Blob([new Uint8Array([255, 216, 255, 0, 255, 217])], { type: 'image/jpeg' });
  const row = { trip: 'trip/river', id: 'catch', hash: await photoHash(image), cycle: 'cycle-1',
    active: true, expires: new Date(Date.now() + 6 * 86400000).toISOString() };
  const other = { ...row, id: 'other' };
  localStorage.setItem(prefix + 'photos', JSON.stringify([row, other]));
  const pending = () => JSON.parse(localStorage.getItem(prefix + 'photoRenewals') || '[]');
  const view = { active: () => true };
  const article = document.querySelector('article');
  bindCatchPhoto(article, { id: row.id, tripId: 'river' }, 'blob:example', view,
    () => { throw Error('Preview contacted the server'); }, image);
  assert.equal(pending().length, 0);
  await article.querySelector('button').onclick();
  assert.equal(dismissPhotoDetail(), true);
  assert.equal(document.querySelector('dialog'), null);
  assert.deepEqual(pending().map(({ id, cycle }) => [id, cycle]), [['catch', 'cycle-1']]);
  await article.querySelector('button').onclick();
  dismissPhotoDetail();
  assert.equal(pending().length, 1);
  await assert.rejects(() => refreshPhotoLeases(async () => { throw Error('offline'); }, subject, prefix), /offline/);
  assert.equal(pending().length, 1);
  const aside = document.querySelector('aside');
  bindExpirySummary(aside, subject);
  aside.querySelectorAll('input')[0].checked = false;
  aside.querySelector('button').click();
  assert.deepEqual(pending().map(x => x.id), ['catch', 'other']);
  const calls = [];
  await refreshPhotoLeases(async (op, args) => {
    calls.push(op);
    if (op === 'photo_renew') { assert.equal(args.cycle, 'cycle-1'); return { expired: true }; }
    assert.equal(op, 'photo_list');
    return { revision: '3', photos: [{...row, active: false}, {...other, active: false}] };
  }, subject, prefix);
  assert.deepEqual(calls, ['photo_renew', 'photo_renew', 'photo_list']);
  assert.equal(pending().length, 0);
  assert.equal(article.querySelector('p').textContent, 'retention.local');
  view.dispose();
});
