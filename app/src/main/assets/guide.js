import { label as t } from './i18n.js';
import { fold } from './domain.js';

let chapters;
let previousFocus;
let request = 0;
const get = id => document.getElementById(id);
const node = (tag, value) => Object.assign(document.createElement(tag), { textContent: value });

function action(label, click) {
  const button = node('button', label);
  button.type = 'button';
  button.className = 'secondary';
  button.onclick = click;
  return button;
}

/** Keep field help, page chapters and the searchable index in the current editing session. */
export async function openGuide({ page, topic, field } = {}) {
  const current = ++request;
  const dialog = get('guide-dialog');
  const standalone = !!document.body.dataset.nativeGuide;
  if (!standalone && !dialog.open) {
    previousFocus = document.activeElement;
    dialog.showModal();
    dialog.onclose = () => {
      if (dialog.open) return;
      ++request;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }
  const title = get('guide-title');
  const body = get('guide-body');
  const index = get('guide-index');
  if (!standalone) {
    get('guide-close').textContent = t('common.close');
    get('guide-close').onclick = () => dialog.close();
  }
  index.textContent = t('guide.all_features');
  index.onclick = () => openGuide();
  index.hidden = !(page || topic || field);
  title.textContent = field?.name || t('common.help');
  body.replaceChildren();
  dialog.scrollTop = 0;
  title.focus({ preventScroll: true });
  if (field) {
    body.append(node('p', t(field.hint.message)),
      action(t('guide.read_related_chapter'), () => openGuide({ topic: field.hint.topic })));
    return;
  }

  try {
    if (!chapters) {
      const response = await fetch('help-topics.json');
      if (!response.ok) throw Error('Guide unavailable');
      chapters = await response.json();
    }
  } catch {
    if (request === current) body.append(action(t('common.retry'), () => openGuide({ page, topic })));
    return;
  }
  if (request !== current || (!standalone && !dialog.open)) return;
  const chapter = topic ? chapters[topic] : Object.values(chapters).find(ch => ch.pages.includes(page));
  index.hidden = !chapter;
  if (chapter) {
    title.textContent = t(chapter.title);
    const steps = document.createElement('ol');
    for (const step of chapter.steps) steps.append(node('li', t(step)));
    body.append(steps);
  } else {
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = input.ariaLabel = t('guide.search_the_guide');
    const list = document.createElement('div');
    function results() {
      const query = fold(input.value.trim());
      list.replaceChildren();
      for (const [id, ch] of Object.entries(chapters)) {
        if (fold([t(ch.title), ...ch.steps.map(t)].join(' ')).includes(query))
          list.append(action(t(ch.title), () => openGuide({ topic: id })));
      }
      if (!list.childElementCount) list.append(node('p', t('guide.no_results_try_a_shorter_search')));
    }
    input.oninput = results;
    body.append(input, list);
    results();
  }
}

export function closeGuide() {
  const dialog = get('guide-dialog');
  if (!dialog?.open) return false;
  dialog.close();
  return true;
}

/** The hint button is outside the label so opening help never changes a form value. */
export function attachHints(root, page, hints) {
  for (const label of root.querySelectorAll('label, fieldset.rating-criterion > legend')) {
    const id = label.tagName === 'LEGEND' ? label.parentElement.querySelector('input')?.name : label.control?.id;
    const hint = hints[page + '.' + id] || hints[id];
    if (!hint || label.nextElementSibling?.classList.contains('field-hint')) continue;
    const name = label.textContent.trim();
    const control = action('?', () => openGuide({ field: { name, hint } }));
    control.className = 'field-hint';
    control.setAttribute('aria-label', t('common.explain') + ' · ' + name);
    control.setAttribute('aria-haspopup', 'dialog');
    control.title = t(hint.message);
    if (label.htmlFor && !label.classList.contains('sr') && label.control?.type !== 'file')
      label.classList.add('label-with-hint');
    label.after(control);
  }
}
