import { translate as t } from './i18n.js';

let chapters;
let previousFocus;
const word = pair => t(pair.cs, pair.en);
const get = id => document.getElementById(id);
const node = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });

/** Render a topic in a modal so reading help never discards a draft or changes navigation history. */
export async function openGuide(page = '', field = '') {
  if (!chapters) {
    const response = await fetch('help-topics.json');
    if (!response.ok) throw Error('Guide unavailable');
    chapters = await response.json();
  }
  const dialog = get('guide-dialog');
  if (!dialog.open) {
    previousFocus = document.activeElement;
    dialog.showModal();
  }
  const host = get('guide-body');
  const chapter = chapters[page] || Object.values(chapters).find(ch => ch.pages.includes(page));
  const title = get('guide-title');
  title.textContent = chapter ? word(chapter.title) : t('Nápověda', 'Help');
  host.replaceChildren();
  const index = get('guide-index');
  index.hidden = !chapter;
  index.textContent = t('Všechny funkce', 'All features');
  index.onclick = () => openGuide();
  get('guide-close').textContent = t('Zavřít', 'Close');
  get('guide-close').onclick = () => dialog.close();
  dialog.onclose = () => previousFocus?.isConnected && previousFocus.focus({ preventScroll: true });
  if (chapter) {
    if (field) host.append(node('p', field));
    const steps = document.createElement('ol');
    chapter.steps.forEach(p => steps.append(node('li', word(p))));
    host.append(steps);
  } else {
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = input.ariaLabel = t('Hledat v nápovědě', 'Search the guide');
    const list = document.createElement('div');
    function results() {
      list.replaceChildren();
      for (const [id,ch] of Object.entries(chapters)) {
        if (![word(ch.title), ...ch.steps.map(word)].join(' ').toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())) continue;
        const action = node('button', word(ch.title));
        action.type = 'button'; action.className = 'secondary'; action.onclick = () => openGuide(id);
        list.append(action);
      }
      if (!list.childElementCount) list.append(node('p', t('Žádný výsledek. Zkus kratší výraz.', 'No results. Try a shorter search.')));
    }
    input.oninput = results;
    host.append(input, list);
    results();
  }
  if (document.body.dataset.nativeGuide) get('guide-close').hidden = true;
  dialog.scrollTop = 0;
  title.focus();
}

export function closeGuide() {
  const dialog = get('guide-dialog');
  if (!dialog?.open) return false;
  dialog.close();
  return true;
}

/** Hints have real buttons usable by touch, keyboard and screen readers. */
export function attachHints(root, page, hints) {
  for (const label of root.querySelectorAll('label[for], fieldset.rating-criterion > legend')) {
    const id = label.htmlFor || label.parentElement.querySelector('input')?.name;
    const hint = hints[id];
    if (!hint || label.nextElementSibling?.classList.contains('field-hint')) continue;
    const control = node('button', '?');
    control.type = 'button'; control.className = 'field-hint';
    const name = label.textContent.trim();
    control.setAttribute('aria-label', t('Vysvětlit', 'Explain') + ' · ' + name);
    control.title = word(hint);
    control.onclick = () => openGuide(hint.topic || page, name + ' — ' + word(hint));
    label.after(control);
  }
}
