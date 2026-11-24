import { by, button, selectField, t, textInput } from './ui.js';
import { fold } from './domain.js';
import { matchesWater } from './water-directory.js';

export function waterPicker(id, label, emptyLabel) {
  return textInput(id + '-search', t('market.find_a_water_by_name_or_number'), '', 'type="search"') +
    selectField(id, label, emptyLabel ? [['', emptyLabel]] : [], '') +
    button(id + '-more', t('waters.show_more_waters'), 'secondary') +
    '<p id="' + id + '-empty" role="status" hidden>' + t('waters.no_matching_water') + '</p>';
}

export function waterOption(water) {
  return [water.name, water.number, water.country, water.code !== water.number ? water.code : ''].filter(Boolean).join(' · ');
}

/** Search the whole edition, while keeping the native list small and the selected identity visible. */
export function bindWaterPicker(id, view, directory, selectedKey, country) {
  const search = by(id + '-search'), select = by(id), more = by(id + '-more');
  const empty = select.options[0]?.text;
  const pageSize = 60;
  let limit = pageSize, retained;
  function populate(key) {
    const query = fold(search.value);
    const selected = directory.byKey.get(key) || (retained?.key === key ? retained : undefined);
    const options = empty ? [new Option(empty, '')] : [];
    let matches = 0, visible = false;
    for (const water of directory.waters) {
      if ((country && water.country !== country) || !matchesWater(water, query)) continue;
      if (++matches > limit) break;
      options.push(new Option(waterOption(water), water.key));
      if (water.key === key) visible = true;
    }
    // Historical offers can retain an identity from a previous edition.
    if (key && !visible) options.push(new Option(selected ? waterOption(selected) : key, key));
    select.replaceChildren(...options);
    select.value = key || '';
    more.hidden = matches <= limit;
    by(id + '-empty').hidden = matches > 0;
    retained = selected;
  }
  populate(selectedKey);
  search.oninput = () => { limit = pageSize; populate(select.value); };
  more.onclick = () => { limit += pageSize; populate(select.value); };
  view.refreshWaters = updated => {
    retained = directory.byKey.get(select.value) || retained;
    directory = updated;
    populate(select.value);
  };
  return () => directory.byKey.get(select.value) || (retained?.key === select.value ? retained : undefined);
}
