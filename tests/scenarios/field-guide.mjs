import assert from 'node:assert/strict';
import {attachHints, closeGuide, openGuide} from '../../app/src/main/assets/guide.js';

export async function run({check, words, json}) {
  const dialog = document.querySelector('#guide-dialog'), body = document.querySelector('#guide-body');
  // jsdom supplies the dialog DOM. The two missing browser methods only change its native open state.
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.onclose?.(); };
  const topics = json('help-topics.json');
  function expectChapter(chapter) {
    assert.equal(document.querySelector('#guide-title').textContent, words(chapter.title));
    assert.deepEqual([...body.querySelectorAll('li')].map(li => li.textContent), chapter.steps.map(words));
  }
  for (const [topic, chapter] of Object.entries(topics)) {
    for (const page of chapter.pages) await check(`page/${page}`, async () => {
      await openGuide({page});
      expectChapter(chapter);
      assert.equal(closeGuide(), true);
    });
    await check(`index/${topic}`, async () => {
      await openGuide();
      const input = body.querySelector('input');
      input.value = words(chapter.title);
      input.dispatchEvent(new Event('input'));
      const button = [...body.querySelectorAll('button')].find(btn => btn.textContent === input.value);
      assert.ok(button);
      await button.onclick();
      expectChapter(chapter);
      assert.equal(closeGuide(), true);
    });
  }
  for (const [key, hint] of Object.entries(json('field-hints.json'))) await check(`hint/${key}`, async () => {
    const [first, second] = key.split('.'), id = second ?? first, page = second ? first : 'unscoped';
    const root = document.createElement('div');
    const input = document.createElement('input'), label = document.createElement('label');
    input.id = label.htmlFor = id;
    label.textContent = 'Field'; input.value = 'unfinished draft'; root.append(label, input);
    document.body.prepend(root);
    try {
      attachHints(root, page, {[key]: hint}); attachHints(root, page, {[key]: hint});
      const buttons = root.querySelectorAll('button');
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].title, words(hint.message));
      buttons[0].focus(); buttons[0].click();
      assert.equal(body.querySelector('p').textContent, words(hint.message));
      await body.querySelector('button').onclick();
      expectChapter(topics[hint.topic]);
      closeGuide();
      assert.equal(document.activeElement, buttons[0]);
      assert.equal(input.value, 'unfinished draft');
    } finally { root.remove(); }
  });
}
