const screen = document.querySelector('#screen');
let noticeTimer;
const cs = (window.Device ? Device.locale() : navigator.language).toLowerCase().startsWith('cs');
const t = (cz, en) => (cs ? cz : en),
  loc = (obj) => obj[cs ? 'cs' : 'en'];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const by = (id) => document.getElementById(id);
const options = (pairs, sel) =>
  pairs
    .map(
      ([val, label]) =>
        '<option value="' +
        esc(val) +
        '"' +
        (val === sel ? ' selected' : '') +
        '>' +
        esc(label) +
        '</option>',
    )
    .join('');
function bind(id, fn) {
  by(id).onclick = fn;
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
  new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  );
function field(id, label, html) {
  return '<label for="' + id + '">' + esc(label) + '</label>' + html;
}
function textInput(id, label, value = '', attrs = '') {
  return field(id, label, '<input id="' + id + '" value="' + esc(value) + '" ' + attrs + '>');
}

/** Keep the submitted snapshot fixed. A failed write releases controls and retains all inputs. */
async function writeEntry(view, nav, tripId, write, onError) {
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
  if (view.active()) nav.journalAfterWrite(tripId);
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
  options,
  bind,
  toast,
  icon,
  button,
  link,
  sectionTitle,
  emptyState,
  back,
  bindBack,
  displayDay,
  field,
  textInput,
  writeEntry,
  trackEdits,
};
