import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export async function run({ check, words, locale, json }) {
  const html = readFileSync(new URL('../../app/src/main/assets/guide.html', import.meta.url), 'utf8');
  const chapters = json('help-topics.json');
  const originalDocument = globalThis.document,
    originalLocation = globalThis.location;
  // Android opens a standalone page. Use its actual markup and module entry point for each deep link.
  for (const theme of ['light', 'dark'])
    for (const topic of ['', 'missing-chapter', ...Object.keys(chapters)]) {
      await check(theme + '/' + (topic || 'index'), async () => {
        const dom = new JSDOM(html, {
          url: 'https://journal.test/guide.html?lang=' + locale + '&theme=' + theme + '#' + topic,
        });
        try {
          globalThis.document = dom.window.document;
          globalThis.location = dom.window.location;
          const script = document.querySelector('script[type=module]').getAttribute('src');
          const entry = new URL('../../app/src/main/assets/' + script, import.meta.url);
          entry.searchParams.set('entry', theme + '/' + topic);
          await import(entry.href);
          assert.equal(document.documentElement.lang, locale);
          assert.equal(document.documentElement.dataset.theme, theme);
          assert.equal(document.title, words('common.help'));
          assert.equal(document.activeElement.id, 'guide-title');
          const chapter = chapters[topic];
          if (chapter) {
            assert.equal(document.getElementById('guide-title').textContent, words(chapter.title));
            assert.deepEqual(
              [...document.querySelectorAll('ol li')].map((item) => item.textContent),
              chapter.steps.map(words),
            );
            await document.getElementById('guide-index').onclick();
          }
          assert.ok(document.querySelector('#guide-body input[type=search]'));
          assert.equal(document.querySelectorAll('#guide-body button').length, Object.keys(chapters).length);
        } finally {
          globalThis.document = originalDocument;
          if (originalLocation === undefined) delete globalThis.location;
          else globalThis.location = originalLocation;
          dom.window.close();
        }
      });
    }
}
