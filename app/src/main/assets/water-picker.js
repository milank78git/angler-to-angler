import { by, button, esc, selectField, t, textInput } from './ui.js';
import { fold } from './domain.js';
import { matchesWater } from './water-directory.js';

/** Render the search and selection controls with optional keyboard-accessible suggestions. */
export function waterPicker(id, label, emptyLabel, { suggestions = false } = {}) {
  const select = selectField(id, label, emptyLabel ? [['', emptyLabel]] : [], '');
  const footer =
    button(id + '-more', t('waters.show_more_waters'), 'secondary') +
    '<p id="' +
    id +
    '-empty" role="status" hidden>' +
    esc(t('waters.no_matching_water')) +
    '</p>';
  const attrs = suggestions
    ? 'type="search" role="combobox" autocomplete="off" aria-autocomplete="list" ' +
      'aria-expanded="false" aria-controls="' +
      id +
      '-suggestions" enterkeyhint="search"'
    : 'type="search"';
  const search = textInput(id + '-search', t('market.find_a_water_by_name_or_number'), '', attrs);
  if (!suggestions) return search + select + footer;
  return (
    '<div class="water-lookup">' +
    search +
    '<div id="' +
    id +
    '-suggestions" class="water-suggestions" role="listbox" aria-label="' +
    esc(label) +
    '" hidden></div>' +
    '<div id="' +
    id +
    '-browse">' +
    select +
    '</div>' +
    footer +
    '</div>'
  );
}

/** Disambiguate similar water names using the available number, country and source code. */
export function waterOption(water) {
  return [water.name, water.number, water.country, water.code !== water.number ? water.code : '']
    .filter(Boolean)
    .join(' · ');
}

/** Present the same filtered identities as the native picker while the user edits the query. */
function bindSuggestions(id, search, select) {
  const list = by(id + '-suggestions'),
    browse = by(id + '-browse');
  let open = false,
    active;

  /** Collapse suggestions and clear the accessible active option. */
  function close() {
    open = false;
    active = undefined;
    list.hidden = true;
    browse.hidden = false;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  }

  /** Expose only the currently filtered options in the suggestion list. */
  function render() {
    if (!open || !search.value.trim()) return close();
    active = undefined;
    search.removeAttribute('aria-activedescendant');
    const rows = Array.from(select.options)
      .filter((option) => option.value)
      .map((option, i) => {
        const row = document.createElement('div');
        row.id = list.id + '-' + i;
        row.dataset.key = option.value;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.textContent = option.text;
        return row;
      });
    list.replaceChildren(...rows);
    list.hidden = !rows.length;
    browse.hidden = true;
    search.setAttribute('aria-expanded', String(!list.hidden));
  }

  /** Open the suggestions for the current query and reset their scroll position. */
  function show() {
    open = true;
    render();
    list.scrollTop = 0;
  }

  /** Commit the selected water and emit the same change event as the native select. */
  function choose(row) {
    select.value = row.dataset.key;
    close();
    select.focus({ preventScroll: true });
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  search.onfocus = show;
  search.onclick = () => {
    if (!open) show();
  };
  search.parentElement.onfocusout = (event) => {
    if (!search.parentElement.contains(event.relatedTarget)) close();
  };
  // Keep the input focused until the click commits, including a synthesized touch click.
  list.onmousedown = (event) => event.preventDefault();
  list.onclick = (event) => {
    const row =
      event.target instanceof Element && /** @type {HTMLElement} */ (event.target.closest('[role="option"]'));
    if (row) choose(row);
  };
  search.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && !list.hidden) {
      event.preventDefault();
      const row = active || (list.childElementCount === 1 && list.firstElementChild);
      if (row) choose(row);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) show();
      if (list.hidden) return;
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      const next = active
        ? (down ? active.nextElementSibling : active.previousElementSibling) || active
        : down
          ? list.firstElementChild
          : list.lastElementChild;
      active?.setAttribute('aria-selected', 'false');
      active = next;
      active.setAttribute('aria-selected', 'true');
      search.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  };
  return { show, render };
}

/** Search the whole edition, while keeping the native list small and the selected identity visible. */
export function bindWaterPicker(id, view, directory, selectedKey, country, onSearch) {
  const search = /** @type {HTMLInputElement} */ (by(id + '-search'));
  const select = /** @type {HTMLSelectElement} */ (by(id));
  const more = by(id + '-more');
  const suggestions = by(id + '-suggestions') && bindSuggestions(id, search, select);
  // A form commits an identity on selection. Only a live rule lookup previews a unique match.
  const confirmChoice = suggestions && !onSearch;
  let confirmedKey = selectedKey;
  const empty = select.options[0]?.text;
  const pageSize = 60;
  let limit = pageSize,
    retained;
  /** Rebuild the bounded page while distinguishing a typed query from a committed identity. */
  function populate(key, typing = false) {
    const query = fold(search.value);
    const selected = directory.byKey.get(key) || (retained?.key === key ? retained : undefined);
    const options = empty ? [new Option(empty, '')] : [];
    let matches = 0,
      visible = false;
    for (const water of directory.waters) {
      if ((country && water.country !== country) || !matchesWater(water, query)) continue;
      if (++matches > limit) break;
      options.push(new Option(waterOption(water), water.key));
      if (water.key === key) visible = true;
    }
    if (confirmChoice && typing && query) {
      key = '';
    } else if (onSearch && typing) {
      key = query && matches === 1 ? options[options.length - 1].value : '';
    } else if (key && !visible) {
      // Editors can retain historical identities. A live lookup only displays matching waters.
      if (onSearch && query && (!selected || !matchesWater(selected, query))) key = '';
      else options.push(new Option(selected ? waterOption(selected) : key, key));
    }
    select.replaceChildren(...options);
    select.value = key || '';
    more.hidden = matches <= limit;
    by(id + '-empty').hidden = matches > 0;
    if (selected) retained = selected;
    if (typing) suggestions?.show();
    else suggestions?.render();
  }
  populate(selectedKey);
  search.oninput = () => {
    limit = pageSize;
    populate(confirmChoice ? confirmedKey : select.value, true);
    if (onSearch) onSearch(directory.byKey.get(select.value), search.value);
  };
  if (confirmChoice)
    select.addEventListener('change', () => {
      confirmedKey = select.value;
      search.value = '';
      populate(confirmedKey);
    });
  more.onclick = () => {
    limit += pageSize;
    populate(select.value);
  };
  view.refreshWaters = (updated) => {
    retained = directory.byKey.get(select.value) || retained;
    directory = updated;
    populate(select.value);
  };
  return () => directory.byKey.get(select.value) || (retained?.key === select.value ? retained : undefined);
}
