import { insertMarkup, replaceMarkup } from './markup.js';
import { Journal } from './journal.js';
import { catchLatin } from './catch-species.js';
import { fishDirectory } from './fish-catalogue.js';
import { rpc, failure } from './profile-api.js';
import { back, bindBack, by, button, esc, screen, t } from './ui.js';

/** Increment the bucket for one recorded observation. */
function add(counts, key, label) {
  const row = counts.get(key);
  if (row) row.count++;
  else counts.set(key, { label, count: 1 });
}
/** Order the most frequent entries first and resolve equal counts by display label. */
const ranked = (counts) =>
  [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

/** Preserve distinct catalogue identities even when two waters have the same name. */
export function personalTotals(trips, catches, pack, fish) {
  const waters = new Map(),
    species = new Map();
  for (const trip of trips)
    add(
      waters,
      trip.waterId ? JSON.stringify([trip.country, trip.waterId]) : 'manual:' + trip.waterName,
      trip.waterName,
    );
  for (const entry of catches) {
    const latin = catchLatin(entry, pack, fish);
    const label = fish?.names.get(latin)?.label || entry.speciesName || entry.speciesId;
    if (label) add(species, latin || entry.speciesId || 'manual:' + entry.speciesName, label);
  }
  return { waters: ranked(waters), species: ranked(species) };
}
/** Render the ranked entries or the localized empty state. */
function list(rows) {
  return rows.length
    ? '<ol>' +
        rows
          .slice(0, 10)
          .map((r) => '<li>' + esc(r.label) + ' · <strong>' + r.count + '</strong></li>')
          .join('') +
        '</ol>'
    : '<p>' + esc(t('stats.empty')) + '</p>';
}

/** Combine this device's journal totals with available community samples.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function journalStatistics({ view, nav, pack, waterDirectory }) {
  const [entries, fish] = await Promise.all([Journal.statEntries(), fishDirectory().catch(() => null)]);
  if (!view.active()) return;
  const totals = personalTotals(entries.trips, entries.catches, pack, fish);
  replaceMarkup(
    screen,
    back(t('trips.my_journal')) +
      '<h1>' +
      t('stats.title') +
      '</h1><p>' +
      t('trips.private_on_this_phone') +
      '</p>' +
      '<section class="surface"><h2>' +
      t('stats.visits') +
      '</h2>' +
      list(totals.waters) +
      '</section>' +
      '<section class="surface"><h2>' +
      t('stats.species') +
      '</h2>' +
      list(totals.species) +
      '</section>' +
      '<details id="community-stats" class="fold"><summary>' +
      t('stats.community') +
      '</summary><div id="shared-visits" class="fold-body"></div></details>',
  );
  bindBack(nav);
  const panel = by('community-stats'),
    body = by('shared-visits');
  let loading = false,
    loaded = false;
  /** Reload statistics for the active panel without changing the private journal. */
  async function refresh() {
    if (loading || loaded) return;
    loading = true;
    body.textContent = t('messages.loading');
    const [visits, catches] = await Promise.allSettled([rpc('top_waters'), rpc('top_species')]);
    if (!view.active()) return;
    /** Identify the month and source of the shared sample displayed below a ranking. */
    const period = (result) =>
      '<p>' +
      esc(result.month.slice(0, 7)) +
      ' · ' +
      esc(t('stats.shared_sample')) +
      ' ' +
      esc(t('stats.independent_reviews')) +
      '</p>';
    /** Show the reason a community ranking could not load alongside the available private statistics. */
    const unavailable = (result) => '<p>' + esc(failure(result.reason)) + '</p>';
    const visitsHtml =
      visits.status === 'fulfilled'
        ? period(visits.value) +
          list(
            visits.value.waters.map((row) => ({
              label: waterDirectory.byKey.get(row.water)?.name || row.water,
              count: row.visits,
            })),
          )
        : unavailable(visits);
    const speciesHtml =
      catches.status === 'fulfilled'
        ? period(catches.value) +
          list(
            catches.value.species.map((row) => ({
              label: fish?.names.get(row.latin)?.label || row.latin,
              count: row.fish,
            })),
          )
        : unavailable(catches);
    replaceMarkup(
      body,
      '<h3>' +
        t('stats.shared_visits') +
        '</h3>' +
        visitsHtml +
        '<h3>' +
        t('stats.shared_species') +
        '</h3>' +
        speciesHtml,
    );
    loaded = visits.status === 'fulfilled' && catches.status === 'fulfilled';
    loading = false;
    if (!loaded) {
      insertMarkup(body, 'beforeend', button('retry-stats', t('common.retry'), 'secondary'));
      by('retry-stats').onclick = refresh;
    }
  }
  panel.ontoggle = () => {
    if (panel.open) refresh();
  };
}
