const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

test('rendering preserves form state, accessibility, offline icons and SVG map layers', async (t) => {
  const { window } = new JSDOM('<main></main>');
  global.window = window;
  t.after(() => {
    delete global.window;
    window.close();
  });
  const { replaceMarkup, insertMarkup } = await import('../app/src/main/assets/markup.js');
  const panel = window.document.querySelector('main');
  replaceMarkup(
    panel,
    '<form id="form"><label for="day">Day</label><input id="day" required>' +
      '<select id="water"><option value="local" selected>River</option></select>' +
      '<button data-trip="42" aria-label="Details">Open</button></form>' +
      '<svg><use href="icons.svg#map"></use><image href="world-land.svg"/></svg>',
  );
  assert.equal(panel.querySelector('label').control, panel.querySelector('input'));
  assert.equal(panel.querySelector('input').required, true);
  assert.equal(panel.querySelector('select').value, 'local');
  assert.equal(panel.querySelector('button').dataset.trip, '42');
  assert.equal(panel.querySelector('button').getAttribute('aria-label'), 'Details');
  assert.equal(panel.querySelector('use').getAttribute('href'), 'icons.svg#map');
  assert.equal(panel.querySelector('image').namespaceURI, 'http://www.w3.org/2000/svg');
  insertMarkup(panel.querySelector('form'), 'afterend', '<p>Updated</p>');
  assert.equal(panel.children[1].textContent, 'Updated');
  replaceMarkup(panel, '<svg><use href="external.svg#map"></use></svg><p onclick="">Text</p>');
  assert.equal(panel.querySelector('use').hasAttribute('href'), false);
  assert.equal(panel.querySelector('p').hasAttribute('onclick'), false);
  assert.equal(panel.querySelector('form'), null);
});

test('static journal control IDs survive the browser named-property protection', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.resolve(__dirname, '../app/src/main/assets');
  const { window } = new JSDOM();
  try {
    const document = window.document;
    const form = document.createElement('form');
    const ids = /\b(?:button|textInput|selectField)\(\s*'([a-z][a-z0-9-]*)'|\bid="([a-z][a-z0-9-]*)"/g;
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(directory, file), 'utf8');
      for (const match of source.matchAll(ids)) {
        const id = match[1] || match[2];
        // Chromium exposes the legacy document.all collection even when a DOM emulator omits it.
        assert.ok(id !== 'all' && !(id in document) && !(id in form), file + ' uses a reserved ID: ' + id);
      }
    }
  } finally {
    window.close();
  }
});
