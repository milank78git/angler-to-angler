import { language, languageTag, translate } from './i18n.js';
const screen = document.querySelector('#screen');
let noticeTimer;
let finishConfirmation;
const cs = language === 'cs';
const t = translate, loc = obj => obj[language] || obj.en || obj.cs;
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const by = (id) => document.getElementById(id);
function selectField(id, label, items, selected) {
  const options = items.map(
    ([value, text]) =>
      `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`,
  );
  return field(id, label, `<select id="${id}">${options.join('')}</select>`);
}
function bind(id, fn) {
  by(id).onclick = fn;
}
/** Resolve only the open prompt. Android Back and Escape both count as cancellation. */
function closeConfirmation(accepted) {
  const dialog = by('confirmation');
  if (!dialog.open) return false;
  dialog.close(accepted ? 'accept' : 'cancel');
  // The browser queues its close event. Release the current prompt before another tap.
  finishConfirmation?.(accepted);
  return true;
}

function dismissConfirmation() {
  return closeConfirmation(false);
}

function confirmAction({ title, message, accept, destructive = false, catchPreview }) {
  const dialog = by('confirmation');
  if (dialog.open) return Promise.resolve(false);
  finishConfirmation?.(false);
  by('confirmation-icon').innerHTML = icon(catchPreview ? 'camera' : 'triangle-alert');
  by('confirmation-title').textContent = title;
  by('confirmation-catch').hidden = !catchPreview;
  const image = by('confirmation-photo');
  if (catchPreview) {
    by('confirmation-species').textContent = catchPreview.species;
    by('confirmation-water').textContent = catchPreview.water;
    image.hidden = !catchPreview.url;
    if (catchPreview.url) image.src = catchPreview.url;
  }
  by('confirmation-message').textContent = message;
  const cancelButton = by('confirmation-cancel');
  const acceptButton = by('confirmation-accept');
  cancelButton.textContent = t('Zrušit', 'Cancel');
  cancelButton.onclick = dismissConfirmation;
  acceptButton.textContent = accept;
  acceptButton.className = destructive ? 'danger' : 'primary';
  acceptButton.onclick = () => closeConfirmation(true);
  dialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    finishConfirmation = (accepted) => {
      finishConfirmation = null;
      dialog.onclose = dialog.oncancel = null;
      image.removeAttribute('src');
      resolve(accepted);
    };
    dialog.oncancel = (event) => {
      event.preventDefault();
      dismissConfirmation();
    };
    // An externally closed dialog may deliver its event after a new prompt has opened.
    dialog.onclose = () => {
      if (!dialog.open) finishConfirmation?.(false);
    };
    dialog.showModal();
  });
}

function toast(message) {
  by('notice').textContent = message;
  by('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (by('notice').hidden = true), 4600);
}
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" focusable="false"><use href="icons.svg#${name}"></use></svg>`;
const button = (id, label, cls = '', glyph = '') =>
  `<button id="${id}" type="button" class="${cls}">${glyph ? icon(glyph) : ''}<span>${esc(label)}</span></button>`;
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;
const sectionTitle = (glyph, label) => `<h2 class="section-title">${icon(glyph)}${esc(label)}</h2>`;
const emptyState = (glyph, title, body = '') =>
  `<div class="empty">${icon(glyph)}<strong>${esc(title)}</strong>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
const back = (label) => button('back', label, 'back', 'arrow-left');
function bindBack(nav) {
  bind('back', () => nav.back());
}
const displayDay = (day) =>
  new Intl.DateTimeFormat(languageTag, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  );
function field(id, label, html) {
  return '<label for="' + id + '">' + esc(label) + '</label>' + html;
}
function textInput(id, label, value = '', attrs = '') {
  return field(id, label, '<input id="' + id + '" value="' + esc(value) + '" ' + attrs + '>');
}

/** Keep the submitted snapshot fixed. A failed write releases controls and retains all inputs. */
async function submitChange(view, write, onSuccess, onError) {
  if (!view.active() || view.saving) return;
  view.saving = true;
  const controls = Array.from(screen.querySelectorAll('button,input,select,textarea')).filter(
    (el) => !el.disabled,
  );
  controls.forEach((el) => {
    el.disabled = true;
  });
  screen.setAttribute('aria-busy', 'true');
  try {
    await write();
  } catch (error) {
    if (view.active()) onError(error);
    return;
  } finally {
    view.saving = false;
    if (view.active()) {
      controls.forEach((el) => {
        el.disabled = false;
      });
      screen.removeAttribute('aria-busy');
    }
  }
  if (view.active()) onSuccess();
}

function writeEntry(view, nav, tripId, write, onError) {
  return submitChange(view, write, () => nav.journalAfterWrite(tripId), onError);
}

function trackEdits(form, view) {
  const changed = () => {
    view.dirty = true;
  };
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
}

export {
  screen,
  cs,
  t,
  loc,
  esc,
  by,
  selectField,
  bind,
  toast,
  icon,
  button,
  link,
  sectionTitle,
  emptyState,
  back,
  bindBack,
  confirmAction,
  dismissConfirmation,
  displayDay,
  field,
  textInput,
  submitChange,
  writeEntry,
  trackEdits,
};
