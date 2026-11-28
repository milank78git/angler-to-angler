const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

test('compact journal controls preserve recovery, navigation and focused search', async (t) => {
  const assets = path.join(__dirname, '../app/src/main/assets');
  const json = (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { window } = new JSDOM(readFileSync(path.join(assets, 'index.html'), 'utf8'), {
    url: 'https://journal.test/',
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    localStorage: window.localStorage,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    Device: { localeTag: () => 'en', subjectId: () => 'compact-owner' },
    fetch: async (name) => ({ ok: true, json: async () => json(name) }),
  });
  window.Device = globalThis.Device;
  localStorage.setItem('journal.sync.v1.compact-owner.enabled', '0');
  const dialogOpeners = new WeakMap();
  // Model native dialog autofocus and return focus before the queued close event.
  window.HTMLDialogElement.prototype.showModal = function () {
    dialogOpeners.set(this, document.activeElement);
    this.open = true;
    this.querySelector('[autofocus]')?.focus();
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    const opener = dialogOpeners.get(this);
    if (opener?.isConnected) opener.focus();
    queueMicrotask(() => this.dispatchEvent(new Event('close')));
  };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(() => window.close());
  const { loadDictionary, label } = await import('../app/src/main/assets/i18n.js');
  await loadDictionary();
  const { bindJournalControls, dismissJournalControls } = await import(
    '../app/src/main/assets/journal-controls.js'
  );
  const { replaceMarkup } = await import('../app/src/main/assets/markup.js');
  const by = (id) => document.getElementById(id);
  const screen = by('screen');

  /** Mount realistic button/panel pairs without involving synchronization or navigation. */
  function controls() {
    replaceMarkup(
      screen,
      `<section class="journal-head">
        <button id="journal-sync-toggle" type="button" aria-controls="journal-sync-details"
          aria-expanded="false" aria-label="Journal synchronization">Sync</button>
        <section id="journal-sync-details" hidden><div id="journal-sync">
          <button type="button" id="sync-action">Retry</button></div></section>
        <button id="journal-menu-toggle" type="button" aria-controls="journal-menu"
          aria-expanded="false" aria-label="Journal options">Options</button>
        <section id="journal-menu" hidden><button type="button" id="trip-stats">Statistics</button></section>
        <button id="journal-sync-notice" type="button">Synchronization failed</button>
      </section><input id="outside-search" aria-label="Search trips">`,
    );
    return bindJournalControls(screen.querySelector('.journal-head'));
  }

  /** Dispatch a cancellable keyboard event from the currently focused control. */
  function escape() {
    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event;
  }

  await t.test('secondary controls open on demand and a second tap closes the same panel', () => {
    const binding = controls();
    try {
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('journal-menu').hidden, true);
      by('journal-sync-toggle').click();
      assert.equal(by('journal-sync-details').hidden, false);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'true');
      by('sync-action').click();
      assert.equal(by('journal-sync-details').hidden, false, 'An action inside the panel must remain usable');
      by('journal-sync-toggle').click();
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'false');
    } finally {
      binding.dispose();
    }
  });

  await t.test('switching panels closes the old one and outside input keeps its focus', () => {
    const binding = controls();
    try {
      by('journal-sync-toggle').click();
      by('journal-menu-toggle').click();
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(by('journal-menu').hidden, false);
      const search = by('outside-search');
      search.focus();
      search.click();
      assert.equal(by('journal-menu').hidden, true);
      assert.equal(document.activeElement, search, 'Closing a panel must not interrupt typing outside it');
    } finally {
      binding.dispose();
    }
  });

  await t.test(
    'a visible recovery notice opens details and never toggles an open recovery panel shut',
    () => {
      const binding = controls();
      try {
        by('journal-menu-toggle').click();
        by('journal-sync-notice').click();
        assert.equal(by('journal-menu').hidden, true);
        assert.equal(by('journal-sync-details').hidden, false);
        assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'true');
        by('journal-sync-notice').click();
        assert.equal(by('journal-sync-details').hidden, false);
      } finally {
        binding.dispose();
      }
    },
  );

  await t.test('Escape returns focus to the opener and native Back is consumed exactly once', () => {
    const binding = controls();
    try {
      by('journal-menu-toggle').click();
      by('trip-stats').focus();
      escape();
      assert.equal(by('journal-menu').hidden, true);
      assert.equal(document.activeElement, by('journal-menu-toggle'));
      assert.equal(binding.close(), false);
      by('journal-sync-toggle').click();
      by('sync-action').focus();
      assert.equal(dismissJournalControls(), true);
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(document.activeElement, by('journal-sync-toggle'));
      assert.equal(dismissJournalControls(), false);
    } finally {
      binding.dispose();
    }
  });

  await t.test('Escape in a confirmation dialog leaves the underlying sync panel open', () => {
    const binding = controls();
    try {
      by('journal-sync-toggle').click();
      by('confirmation').showModal();
      by('confirmation-cancel').focus();
      escape();
      assert.equal(by('journal-sync-details').hidden, false);
      assert.equal(document.activeElement, by('confirmation-cancel'));
    } finally {
      by('confirmation').close();
      binding.dispose();
    }
  });

  await t.test('retired controls cannot consume Back or affect a newly mounted screen', () => {
    const first = controls();
    by('journal-menu-toggle').click();
    first.dispose();
    assert.equal(dismissJournalControls(), false);
    const next = controls();
    try {
      by('journal-menu-toggle').click();
      by('trip-stats').focus();
      escape();
      assert.equal(by('journal-menu').hidden, true);
      assert.equal(document.activeElement, by('journal-menu-toggle'));
      assert.equal(dismissJournalControls(), false);
    } finally {
      next.dispose();
    }
  });

  const { Journal } = await import('../app/src/main/assets/journal.js');
  const { listTrips } = await import('../app/src/main/assets/trips.js');
  const lipno = { id: 'lipno', country: 'CZ', number: '421 200', name: 'Lipno' };
  const stream = { id: 'stream', country: 'CZ', number: '401 024', name: 'V\u00fdmola' };
  const directory = {
    byId: new Map([
      [lipno.id, lipno],
      [stream.id, stream],
    ]),
    byKey: new Map(),
  };
  const trips = [
    {
      id: 'first',
      waterId: lipno.id,
      country: 'CZ',
      waterName: lipno.name,
      day: '2026-11-27',
      created: 2,
      catchCount: 1,
    },
    {
      id: 'second',
      waterId: stream.id,
      country: 'CZ',
      waterName: stream.name,
      day: '2026-11-25',
      created: 1,
      catchCount: 0,
    },
  ];

  /** Render the production journal against a controlled read-only local snapshot. */
  async function mount(child, rows = trips, query = '') {
    child.mock.method(Journal, 'listTrips', async () => rows.map((row) => ({ ...row })));
    const opened = [];
    const view = { route: { page: 'trips', query }, active: () => true, dispose() {} };
    await listTrips({ view, nav: { open: (...args) => opened.push(args) }, waterDirectory: directory });
    child.after(() => view.dispose());
    return { view, opened };
  }

  await t.test(
    'the diary keeps creation visible while synchronization actions and statistics are collapsed',
    async (child) => {
      const { opened } = await mount(child);
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('journal-menu').hidden, true);
      assert.equal(by('journal-sync-notice').hidden, true);
      assert.ok(by('trip-stats').closest('[hidden]'));
      assert.ok(by('journal-sync').querySelector('[data-action="sync.enable"]').closest('[hidden]'));
      assert.ok(by('journal-sync-toggle').getAttribute('aria-label'));
      assert.ok(by('journal-menu-toggle').getAttribute('aria-label'));
      assert.equal(by('add-trip').closest('[hidden]'), null);
      assert.equal(by('add-trip').textContent.trim(), label('trips.new_trip'));
      by('add-trip').click();
      assert.deepEqual(opened, [['newTrip']]);
    },
  );

  await t.test('statistics and journal help remain reachable through the compact menu', async (child) => {
    const { opened } = await mount(child);
    by('journal-menu-toggle').click();
    by('trip-stats').click();
    assert.deepEqual(opened, [['journalStatistics']]);
    by('journal-menu-toggle').click();
    by('trip-help').click();
    assert.equal(by('journal-menu').hidden, true);
    assert.equal(by('guide-dialog').open, true);
    for (let index = 0; index < 10 && !by('guide-body').childElementCount; index++) await Promise.resolve();
    assert.equal(by('guide-title').textContent, label('help-topics.journal.title'));
    by('guide-dialog').close();
  });

  await t.test(
    'typing and water refresh retain the search input, query and selected trip identity',
    async (child) => {
      const { view, opened } = await mount(child, trips, '421200');
      const search = by('trip-search');
      assert.equal(search.value, '421200');
      assert.deepEqual(
        [...screen.querySelectorAll('[data-trip]')].map((row) => row.dataset.trip),
        ['first'],
      );
      search.focus();
      search.value = 'vymola';
      search.dispatchEvent(new Event('input'));
      assert.equal(view.route.query, 'vymola');
      assert.equal(by('trip-search'), search);
      assert.equal(document.activeElement, search);
      view.refreshWaters(directory);
      assert.equal(by('trip-search'), search);
      assert.equal(document.activeElement, search);
      assert.equal(search.value, 'vymola');
      assert.deepEqual(
        [...screen.querySelectorAll('[data-trip]')].map((row) => row.dataset.trip),
        ['second'],
      );
      screen.querySelector('[data-trip]').click();
      assert.deepEqual(opened, [['trip', { id: 'second' }]]);
      search.value = 'no matching water';
      search.dispatchEvent(new Event('input'));
      assert.equal(screen.querySelectorAll('[data-trip]').length, 0);
      assert.equal(by('trip-results').textContent, label('trips.no_matching_trips'));
    },
  );

  await t.test(
    'a background sync status refresh does not close the open details or reset the query',
    async (child) => {
      await mount(child, trips, 'lipno');
      const trigger = by('journal-sync-toggle');
      trigger.focus();
      trigger.click();
      window.dispatchEvent(new Event('journal-sync-status'));
      assert.equal(by('journal-sync-details').hidden, false);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(document.activeElement, trigger);
      assert.equal(by('trip-search').value, 'lipno');
      assert.deepEqual(
        [...screen.querySelectorAll('[data-trip]')].map((row) => row.dataset.trip),
        ['first'],
      );
      const previousAction = by('journal-sync').querySelector('[data-action="sync.enable"]');
      previousAction.focus();
      window.dispatchEvent(new Event('journal-sync-status'));
      await Promise.resolve();
      assert.equal(previousAction.isConnected, false);
      assert.equal(document.activeElement, by('journal-sync').querySelector('[data-action="sync.enable"]'));
      dismissJournalControls();
      const search = by('trip-search');
      search.focus();
      window.dispatchEvent(new Event('journal-sync-status'));
      assert.equal(document.activeElement, search);
    },
  );

  await t.test(
    'an empty journal retains creation, sync settings and the help menu without an empty search box',
    async (child) => {
      const { opened } = await mount(child, []);
      assert.equal(by('trip-search'), null);
      assert.equal(by('add-trip').closest('[hidden]'), null);
      by('journal-sync-toggle').click();
      assert.equal(by('journal-sync-details').hidden, false);
      assert.ok(by('journal-sync').querySelector('[data-action="sync.enable"]'));
      by('journal-menu-toggle').click();
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('trip-help').closest('[hidden]'), null);
      by('trip-stats').click();
      assert.deepEqual(opened, [['journalStatistics']]);
    },
  );

  await t.test(
    'cancelling sync consent keeps the disclosure open and returns focus to its visible action',
    async (child) => {
      await mount(child);
      let requests = 0;
      window.Device.profileRequest = (id) => {
        requests++;
        queueMicrotask(() => window.profileReply(id, 503, {}));
      };
      child.after(() => delete window.Device.profileRequest);
      by('journal-sync-toggle').click();
      const action = by('journal-sync').querySelector('[data-action="sync.enable"]');
      action.focus();
      action.click();
      assert.equal(by('confirmation').open, true);
      assert.equal(document.activeElement, by('confirmation-cancel'));
      // The click bubbles after close() removes the dialog's open attribute.
      by('confirmation-cancel').click();
      await Promise.resolve();
      assert.equal(by('confirmation').open, false);
      assert.equal(by('journal-sync-details').hidden, false);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(document.activeElement, action);
      assert.equal(document.activeElement.closest('[hidden]'), null);
      assert.equal(by('journal-sync').dataset.state, 'disabled');
      assert.equal(requests, 0);
    },
  );

  await t.test(
    'a failed sync request remains visible after closing details and reopens the recovery controls',
    async (child) => {
      await mount(child);
      window.Device.profileRequest = (id) => queueMicrotask(() => window.profileReply(id, 503, {}));
      child.after(() => delete window.Device.profileRequest);
      by('journal-sync-toggle').click();
      const action = by('journal-sync').querySelector('[data-action="sync.enable"]');
      action.focus();
      const enabling = action.onclick();
      assert.equal(by('confirmation').open, true);
      by('confirmation-accept').click();
      await enabling;
      assert.equal(by('journal-sync-details').hidden, false);
      assert.equal(by('journal-sync-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(document.activeElement.closest('[hidden]'), null);
      assert.equal(by('journal-sync').dataset.state, 'failed');
      assert.equal(by('journal-sync-notice').hidden, false);
      assert.ok(by('journal-sync-notice').textContent.includes(label('sync.failed')));
      assert.equal(dismissJournalControls(), true);
      assert.equal(by('journal-sync-details').hidden, true);
      assert.equal(by('journal-sync-notice').hidden, false);
      by('journal-sync-notice').click();
      assert.equal(by('journal-sync-details').hidden, false);
      assert.ok(by('journal-sync').querySelector('[data-action="sync.enable"]'));
    },
  );
});
