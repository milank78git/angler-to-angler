import { fishDirectory, fishOption, matchingSpecies, seasonalDay, sizeTerms } from './fish-catalogue.js';
import { forFishingDate, scopedFishRules } from './fish-rules.js';
import { today, validDay } from './domain.js';
import { bind, button, by, displayDay, esc, field, link, selectField, t } from './ui.js';

/** Render one dated national reference in both the lookup screen and a private catch draft. */
export function nationalRulesHtml(data, site, type, latin, day, lookup = false) {
  function entry(rule) {
    const source = data.rules.sources[rule.source];
    const status = forFishingDate(rule, source, day);
    let value;
    if (status === 'unverified') value = t('dated_rules.unverified_date');
    else if (rule.closed) value = t(status === 'closed' ? 'dated_rules.active' : 'dated_rules.outside') +
      ' · ' + rule.closed.map(seasonalDay).join(' – ');
    else value = sizeTerms(rule).join(' · ');
    return '<p data-rule-status="' + status + '">' + esc(value) + '</p><p class="meta">' + link(source.url, source.title) +
      ' · ' + esc(t('seasons.checked')) + ' ' + esc(displayDay(source.checked)) + '</p>';
  }

  function section(id, title, rows, missing) {
    return '<section class="surface"' + (lookup ? ' id="' + id + '"' : '') + '><h3>' + esc(t(title)) + '</h3>' +
      (rows.length ? rows.map(entry).join('') : '<p>' + esc(t(missing)) + '</p>') + '</section>';
  }

  let result = '<h2>' + esc(t('dated_rules.national')) + '</h2>';
  if (!type || !validDay(day)) {
    result += '<p>' + esc(t(type ? 'dated_rules.choose_date' : 'dated_rules.choose_class')) + '</p>';
  } else {
    const rules = scopedFishRules(data.rules, site.country, type, latin);
    if (rules.water.length)
      result += section('lookup-water', 'fish_rules.water_conditions', rules.water, '');
    if (latin) {
      result += section('lookup-size', 'fish_rules.size', rules.species.filter(rule => sizeTerms(rule).length), 'fish_rules.size_unverified') +
        section('lookup-closure', 'fish_rules.species_conditions', rules.species.filter(rule => rule.closed), 'fish_rules.no_species_conditions');
    } else result += '<p>' + esc(t(lookup ? 'dated_rules.choose_species' : 'catch_picker.unidentified_rules')) + '</p>';
  }
  return result + '<p>' + esc(t('dated_rules.local')) + ' ' +
    link(site.source, site.name) + '</p>';
}

/** Show national rules for a dated Czech water selection alongside the manager's original entry. */
export async function waterFishRules(view, nav, site) {
  const data = await fishDirectory();
  if (!view.active()) return;
  const route = view.route;
  const species = matchingSpecies(data, site.country, '');
  const requested = route.lookupLatin ?? route.latin ?? '';
  const selected = data.names.get(requested);
  if (selected && !species.includes(selected)) species.push(selected);

  const classes = [['nontrout', t('waters.non_trout_water')], ['cztrout', t('waters.trout_water')]];
  const publishedClass = typeof site.trout === 'boolean' ? (site.trout ? 'cztrout' : 'nontrout') : '';
  const waterClass = publishedClass || route.lookupClass || '';
  const date = route.day ?? today(site.zone);
  by('rule-fields').innerHTML = (publishedClass ? '<p>' + esc(t('fish_rules.water_class')) + ' · ' +
    esc(t(site.trout ? 'waters.trout_water' : 'waters.non_trout_water')) + '</p>' :
    selectField('lookup-class', t('fish_rules.water_class'), [['', t('dated_rules.choose_class')], ...classes], waterClass)) +
    selectField('lookup-species', t('common.fish_species'), [['', t('dated_rules.choose_species')],
      ...species.map(fish => [fish.latin, fishOption(fish)])], requested) +
    field('rule-date', t('seasons.fishing_date'), '<input id="rule-date" type="date" value="' + esc(date) + '">') +
    button('water-fish-rules', t('fish_catalogue.title'), 'secondary');

  function refresh() {
    by('status').innerHTML = nationalRulesHtml(data, site, publishedClass || by('lookup-class').value,
      by('lookup-species').value, by('rule-date').value, true);
  }

  for (const id of ['lookup-species', 'rule-date', ...(publishedClass ? [] : ['lookup-class'])]) {
    by(id).onchange = () => {
      route.lookupLatin = by('lookup-species').value;
      route.day = by('rule-date').value;
      route.lookupClass = publishedClass || by('lookup-class').value;
      refresh();
    };
  }
  bind('water-fish-rules', () => {
    const latin = by('lookup-species').value;
    const context = { country:site.country, siteId:site.id, waterClass:publishedClass || by('lookup-class').value,
      day:by('rule-date').value };
    nav.open(latin ? 'fishDetail' : 'fishCatalogue', { ...context, latin });
  });
  refresh();
}
