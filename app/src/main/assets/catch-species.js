import { replaceMarkup } from './markup.js';
import { countryName, fishOption, matchingSpecies } from './fish-catalogue.js';
import { localSeasonHtml } from './seasons.js';
import { nationalRulesHtml } from './water-fish-rules.js';
import { localRuleWater } from './water-directory.js';
import { button, by, displayDay, esc, link, loc, selectField, t, textInput } from './ui.js';

const manual = 'manual';
const pageSize = 50;

export function catchSpeciesFields() {
  return (
    '<div id="catch-filter">' +
    textInput('catch-search', t('fish_catalogue.find_a_species'), '', 'type="search"') +
    '</div>' +
    '<div id="catch-scope"></div>' +
    selectField('fish', t('common.fish_species'), [], '') +
    '<small id="catch-matches" role="status"></small>' +
    button('catch-more', t('fish_catalogue.more_species'), 'secondary') +
    '<div id="custom-fish" hidden>' +
    textInput('fish-name', t('catch_form.species_name'), '', 'maxlength="100"') +
    '</div>'
  );
}

/** Resolve older pilot keys and scientific catalogue keys without guessing a species from free text. */
export function catchLatin(record, pack, directory) {
  const id = record.speciesId;
  return pack.species[id]?.latin || (directory?.names.has(id) ? id : undefined);
}

/** Apply the same published rules when inspecting either a draft or a saved catch. */
export function catchRulesHtml(pack, directory, site, day, latin) {
  const pilot = localRuleWater(pack, site);
  const pilotId = pilot && Object.keys(pack.species).find((key) => pack.species[key].latin === latin);
  let html = '<p class="meta">' + esc(site.name) + ' · ' + esc(displayDay(day)) + '</p>';
  if (pilotId) {
    html +=
      '<h3>' +
      esc(t('catch_picker.main_section')) +
      '</h3>' +
      localSeasonHtml(pack, pilot, 'main', pilotId, day);
  }
  if (site.country === 'CZ' && directory && typeof site.trout === 'boolean') {
    return html + nationalRulesHtml(directory, site, site.trout ? 'cztrout' : 'nontrout', latin, day);
  }
  return html + '<p>' + esc(t('dated_rules.local')) + ' ' + link(site.source, site.name) + '</p>';
}

/** Use the trip's country independently of the language and the last country browsed in the catalogue. */
export function bindCatchSpecies(pack, trip, directory) {
  const select = by('fish'),
    search = by('catch-search'),
    manualName = by('fish-name');
  const pilotIds = new Map(Object.entries(pack.species).map(([id, fish]) => [fish.latin, id]));
  const panel = by('catch-rules'),
    body = by('catch-rule-body');
  let site,
    limit = pageSize;
  if (directory && trip.country) {
    replaceMarkup(
      by('catch-scope'),
      selectField(
        'catch-country-scope',
        t('catch_picker.scope'),
        [
          [trip.country, countryName(trip.country)],
          ['', t('fish_catalogue.all_of_europe')],
        ],
        trip.country,
      ),
    );
    by('catch-country-scope').onchange = () => {
      limit = pageSize;
      populate();
    };
  }
  select.required = true;

  function showSelection() {
    const custom = select.value === manual;
    by('custom-fish').hidden = !custom;
    manualName.required = custom;
    panel.hidden = !site || !select.value;
    if (panel.open && !panel.hidden)
      replaceMarkup(body, catchRulesHtml(pack, directory, site, trip.day, custom ? null : select.value));
  }

  function populate() {
    const current = select.value;
    const country = by('catch-country-scope')?.value ?? trip.country;
    const matches = directory ? matchingSpecies(directory, country, search.value) : [];
    const options = [
      new Option(t('dated_rules.choose_species'), ''),
      new Option(t('catch-form.other.species'), manual),
    ];
    for (const fish of matches.slice(0, limit)) options.push(new Option(fishOption(fish), fish.latin));
    if (!directory && (!trip.country || trip.country === pack.country)) {
      for (const fish of Object.values(pack.species)) options.push(new Option(loc(fish), fish.latin));
    }
    // A broader search may move the selected species beyond the first page.
    if (current && !options.some((o) => o.value === current)) {
      const retained = matches.find((fish) => fish.latin === current);
      if (retained) options.push(new Option(fishOption(retained), current));
    }
    select.replaceChildren(...options);
    select.value = options.some((o) => o.value === current) ? current : '';
    by('catch-more').hidden = matches.length <= limit;
    by('catch-matches').textContent = !directory
      ? t('catch_picker.unavailable')
      : matches.length
        ? t('fish_catalogue.species_count') + ' · ' + matches.length
        : t('catch_picker.no_match');
    showSelection();
  }

  by('catch-filter').hidden = !directory;
  search.oninput = () => {
    limit = pageSize;
    populate();
  };
  by('catch-more').onclick = () => {
    limit += pageSize;
    populate();
  };
  select.onchange = showSelection;
  panel.ontoggle = () => {
    if (panel.open && panel.isConnected) showSelection();
  };
  populate();
  return {
    setWater(water) {
      site = water;
      showSelection();
    },
    record() {
      const id = select.value;
      if (id === manual) return { speciesId: null, speciesName: manualName.value.trim() };
      const pilotId = pilotIds.get(id);
      return {
        speciesId: pilotId || id,
        speciesName: pilotId ? loc(pack.species[pilotId]) : directory?.names.get(id)?.label || '',
      };
    },
  };
}
