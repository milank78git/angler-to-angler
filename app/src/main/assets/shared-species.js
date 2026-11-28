import { replaceMarkup } from './markup.js';
import { catchLatin } from './catch-species.js';
import { fishDirectory } from './fish-catalogue.js';
import { failure, rpc } from './profile-api.js';
import { button, confirmAction, esc, t } from './ui.js';

/** Only scientific identifiers and counts shown in the confirmation can leave the phone. */
export function bindSharedSpecies(panel, pack, trip, catches, state) {
  const host = panel.querySelector('div');
  let ready = false;
  /** Read the latest voluntary species contribution for this trip. */
  async function refresh() {
    host.textContent = t('messages.loading');
    try {
      const [directory, saved] = await Promise.all([
        fishDirectory(),
        rpc('trip_species', { trip_id: trip.id }),
      ]);
      if (!panel.isConnected) return;
      const counts = {};
      for (const c of catches) {
        const latin = catchLatin(c, pack, directory);
        if (directory.names.has(latin)) counts[latin] = (counts[latin] || 0) + 1;
      }
      const describe = (values) =>
        Object.entries(values || {})
          .map(([latin, n]) => (directory.names.get(latin)?.label || latin) + ' · ' + n)
          .join(', ');
      const preview = describe(counts);
      replaceMarkup(
        host,
        '<p>' +
          esc(t('stats.consent')) +
          '</p><p>' +
          esc(t('stats.current_species')) +
          ' · ' +
          esc(describe(saved.counts) || t('stats.empty')) +
          '</p>' +
          (preview && state.entry.fish === catches.length
            ? '<p>' +
              esc(preview) +
              '</p>' +
              button('publish-species', t('stats.publish_species'), 'secondary')
            : '') +
          (saved.counts ? button('withdraw-species', t('stats.withdraw_species'), 'secondary') : ''),
      );
      /** Apply the requested contribution against its last known revision. */
      async function write(values, title) {
        if (
          !(await confirmAction({
            title,
            message: values ? preview : describe(saved.counts),
            accept: title,
          })) ||
          !panel.isConnected
        )
          return;
        host.querySelectorAll('button').forEach((b) => (b.disabled = true));
        try {
          await rpc('trip_species', {
            trip_id: trip.id,
            trip_revision: state.revision,
            expected_version: saved.version,
            counts: values,
          });
          if (panel.isConnected) await refresh();
        } catch (e) {
          error(e);
        }
      }
      const publish = host.querySelector('#publish-species'),
        withdraw = host.querySelector('#withdraw-species');
      if (publish) publish.onclick = () => write(counts, t('stats.publish_species'));
      if (withdraw) withdraw.onclick = () => write(null, t('stats.withdraw_species'));
    } catch (e) {
      error(e);
    }
  }
  /** Keep local catch entries when sharing the species summary fails. */
  function error(e) {
    if (!panel.isConnected) return;
    replaceMarkup(
      host,
      '<p>' + esc(failure(e)) + '</p>' + button('species-retry', t('common.retry'), 'secondary'),
    );
    host.querySelector('button').onclick = refresh;
  }
  panel.ontoggle = () => {
    if (panel.open && !ready) {
      ready = true;
      refresh();
    }
  };
}
