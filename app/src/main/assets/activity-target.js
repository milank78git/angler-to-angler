import { countryName, fishOption, matchingSpecies } from './fish-catalogue.js';
import { button, by, loc, selectField, t, textInput } from './ui.js';

const pageSize = 100;

/** Receipts from older pilots identify four catalogue fish by their short pack keys. */
export function activityTargetLabel(key, pack, fish) {
  if (key === 'unspecified') return t('water_activity.unspecified');
  if (key === 'other') return t('water_activity.other_species');
  return (
    fish?.names.get(pack.species[key]?.latin || key)?.label ||
    (pack.species[key] ? loc(pack.species[key]) : key)
  );
}

export function targetFields(country) {
  return (
    selectField(
      'activity-scope',
      t('catch_picker.scope'),
      [
        [country, countryName(country)],
        ['', t('fish_catalogue.all_of_europe')],
      ],
      country,
    ) +
    textInput('activity-search', t('fish_catalogue.find_a_species'), '', 'type="search"') +
    selectField('activity-target', t('water_activity.trip_target_species'), [], '') +
    '<small id="activity-matches" role="status"></small>' +
    button('activity-more', t('fish_catalogue.more_species'), 'secondary')
  );
}

/** Keep a saved or deliberately selected target while the angler searches or changes scope. */
export function bindTargetPicker(fish, pack, saved, report = false) {
  const select = by('activity-target'),
    search = by('activity-search'),
    scope = by('activity-scope');
  const initial = pack.species[saved]?.latin || saved;
  const savedFish = fish.names.get(initial);
  if (savedFish && !savedFish.countries.includes(scope.value)) scope.value = '';
  let limit = pageSize;
  function populate(selected) {
    const matches = matchingSpecies(fish, scope.value, search.value);
    const options = report ? [new Option(t('common.all'), '')] : [];
    for (const key of ['unspecified', 'other']) {
      options.push(new Option(activityTargetLabel(key, pack, fish), key));
    }
    for (const row of matches.slice(0, limit)) options.push(new Option(fishOption(row), row.latin));
    if (selected && !options.some((option) => option.value === selected)) {
      options.push(new Option(activityTargetLabel(selected, pack, fish), selected));
    }
    select.replaceChildren(...options);
    select.value = selected;
    by('activity-matches').textContent = t('fish_catalogue.species_count') + ' · ' + matches.length;
    by('activity-more').hidden = matches.length <= limit;
  }
  function filter() {
    limit = pageSize;
    populate(select.value);
  }
  search.oninput = filter;
  scope.onchange = () => {
    limit = pageSize;
    const selected = fish.names.get(select.value);
    const outsideCountry = scope.value && selected && !selected.countries.includes(scope.value);
    populate(outsideCountry ? (report ? '' : 'unspecified') : select.value);
  };
  by('activity-more').onclick = () => {
    limit += pageSize;
    populate(select.value);
  };
  populate(initial);
}
