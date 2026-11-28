import { replaceMarkup } from './markup.js';
import { languageTag } from './i18n.js';
import { rpc, failure } from './profile-api.js';
import { button, displayDay, esc, link, selectField, t } from './ui.js';

let parking;
/** Share the bundled parking dataset and clear the cached request after a failed read. */
export async function parkingPoints() {
  parking ||= fetch('parking.json')
    .then((r) => {
      if (!r.ok) throw Error('parking');
      return r.json();
    })
    .catch((e) => {
      parking = null;
      throw e;
    });
  return parking;
}

/** Format an aggregated community rating for display. */
function score(row) {
  return row.votes
    ? Number(row.average).toLocaleString(languageTag) + ' / 5 · ' + t('common.ratings') + ' ' + row.votes
    : t('common.no_ratings_yet');
}

/** Each review belongs to a single point; a member may leave a note without a score. */
async function parkingFeedback(host, point, onSummary) {
  host.textContent = t('parking.loading');
  let data;
  try {
    data = await rpc('parking_feedback', { point_id: point.id });
    if (!Array.isArray(data?.items)) throw Error('Invalid parking feedback');
  } catch (e) {
    if (!host.isConnected) return;
    replaceMarkup(
      host,
      '<p role="status">' +
        esc(failure(e)) +
        '</p>' +
        button('retry-' + point.id, t('common.retry'), 'secondary'),
    );
    host.querySelector('button').onclick = () => parkingFeedback(host, point, onSummary);
    return;
  }
  if (!host.isConnected) return;
  const key = point.id,
    starsId = 'stars-' + key,
    noteId = 'note-' + key;
  replaceMarkup(
    host,
    selectField(
      starsId,
      t('rating.mine'),
      [['', t('parking.no_score')], ...[1, 2, 3, 4, 5].map((n) => [String(n), n + ' / 5'])],
      String(data.myStars ?? ''),
    ) +
      '<label for="' +
      noteId +
      '">' +
      esc(t('parking.note')) +
      '</label><textarea id="' +
      noteId +
      '" maxlength="500" rows="2"></textarea>' +
      button('review-' + key, t('parking.save_review'), 'secondary') +
      '<p role="status"></p><h4>' +
      esc(t('parking.notes')) +
      '</h4>' +
      '<ul></ul>' +
      button('notes-' + key, t('parking.more_notes'), 'secondary'),
  );
  const stars = host.querySelector('select'),
    note = host.querySelector('textarea'),
    status = host.querySelector('[role=status]');
  const [save, more] = host.querySelectorAll('button'),
    list = host.querySelector('ul');
  /** Append the returned parking notes and the reporting controls for addressable entries. */
  function showNotes(page) {
    for (const entry of page.noteItems ?? page.items) {
      const text = typeof entry === 'string' ? entry : entry.text;
      const item = document.createElement('li');
      item.textContent = text;
      if (entry.id) {
        const report = document.createElement('button');
        report.textContent = t('moderation.report');
        report.onclick = async () => {
          report.disabled = true;
          try {
            await rpc('report_parking_note', { note_id: entry.id, seen_text: text });
            report.textContent = t('common.reported');
          } catch (error) {
            status.textContent = failure(error);
            report.disabled = false;
          }
        };
        item.append(report);
      }
      list.append(item);
    }
    data.next = page.next;
    more.hidden = !page.next;
  }
  /** Enable saving only when the proposed stars or note differ from the stored feedback. */
  function changed() {
    save.disabled =
      (Number(stars.value) || null) === (data.myStars ?? null) && note.value.trim() === (data.myNote || '');
  }
  /** Rebuild this community panel from its latest server response. */
  function render(result) {
    data = result;
    onSummary(result);
    stars.value = String(data.myStars ?? '');
    note.value = data.myNote || '';
    list.replaceChildren();
    showNotes(data);
    changed();
  }
  render(data);
  stars.onchange = note.oninput = changed;
  save.onclick = async () => {
    save.disabled = stars.disabled = note.disabled = more.disabled = true;
    try {
      const result = await rpc('parking_review', {
        point_id: key,
        stars: Number(stars.value) || null,
        note: note.value.trim() || null,
      });
      if (!host.isConnected) return;
      if (!Array.isArray(result?.items)) throw Error('Invalid parking review');
      render(result);
      status.textContent = t('parking.review_saved');
    } catch (e) {
      status.textContent = failure(e);
    } finally {
      more.disabled = stars.disabled = note.disabled = false;
      changed();
    }
  };
  more.onclick = async () => {
    more.disabled = true;
    save.disabled = true;
    stars.disabled = note.disabled = true;
    try {
      const page = await rpc('parking_feedback', { point_id: key, before_id: data.next });
      if (host.isConnected) showNotes(page);
    } catch (e) {
      status.textContent = failure(e);
    } finally {
      more.disabled = stars.disabled = note.disabled = false;
      changed();
    }
  };
}

/** Bind the shared parking list and the actions available to this account. */
export async function waterParking(host, water, nav) {
  const bundled = (await parkingPoints().catch(() => ({})))[water.key] || [];
  if (!host.isConnected) return;
  const edit = (parking) => nav.open('parkingEditor', { id: water.id, parking });
  replaceMarkup(
    host,
    '<h2>' +
      esc(t('parking.title')) +
      '</h2><div class="parking-rows"></div>' +
      button('parking-add', t('parking.add'), 'primary', 'plus') +
      '<p role="status"></p>' +
      button('parking-refresh', t('common.refresh'), 'secondary'),
  );
  host.querySelector('#parking-add').onclick = () => edit(null);
  const rows = host.querySelector('.parking-rows'),
    status = host.querySelector('[role=status]'),
    refresh = host.querySelector('#parking-refresh');
  /** Rebuild this community panel from its latest server response. */
  function render(remote, online) {
    const points = new Map(bundled.map((p) => [p.id, { ...p, revision: 1 }]));
    for (const p of remote) points.set(p.id, { ...points.get(p.id), ...p, point: [p.lon, p.lat] });
    rows.replaceChildren();
    if (!points.size) rows.textContent = t(online ? 'parking.missing' : 'parking.no_offline');
    let index = 0;
    for (const p of points.values()) {
      const card = document.createElement('article');
      card.className = 'parking-card';
      const title = p.name || (p.label ? t(p.label) : t('parking.point'));
      const source =
        p.source && p.revision === 1
          ? link(p.source, t('waters.access_point_source')) + ' · ' + esc(displayDay(p.checked))
          : esc(t('parking.community'));
      replaceMarkup(
        card,
        '<h3>' +
          esc(title) +
          '</h3><p class="meta">' +
          source +
          ' · ' +
          p.point[1].toFixed(6) +
          ', ' +
          p.point[0].toFixed(6) +
          '</p>' +
          '<p>' +
          esc(t('parking.signs')) +
          '</p><div class="quick-actions">' +
          button('drive-' + index, t('parking.drive'), 'primary', 'navigation') +
          (p.canEdit === true ? button('edit-' + index, t('parking.edit'), 'secondary') : '') +
          '</div>',
      );
      const [drive, correct] = card.querySelectorAll('button');
      drive.onclick = () => window.Device?.driveToParking?.(p.point[1], p.point[0]);
      if (correct) correct.onclick = () => edit(p);
      if (online) {
        const report = document.createElement('button');
        report.textContent = t('moderation.report_parking');
        report.onclick = async () => {
          report.disabled = true;
          try {
            await rpc('report_content', { kind: 'parking', target: p.id });
            report.textContent = t('common.reported');
          } catch (error) {
            status.textContent = failure(error);
            report.disabled = false;
          }
        };
        card.append(report);
        const details = document.createElement('details'),
          summary = document.createElement('summary'),
          body = document.createElement('div');
        details.className = 'parking-feedback fold';
        body.className = 'fold-body';
        summary.textContent = t('parking.feedback_action');
        const stats = document.createElement('p');
        stats.className = 'meta';
        card.append(stats);
        const update = (row) => {
          stats.textContent = score(row) + ' · ' + t('parking.notes') + ' (' + row.notes + ')';
        };
        update(p);
        details.append(summary, body);
        card.append(details);
        details.ontoggle = () => {
          if (details.open && !body.hasChildNodes()) parkingFeedback(body, p, update);
        };
      }
      rows.append(card);
      index++;
    }
  }
  /** Refresh the current water's community information from the service. */
  async function load() {
    refresh.disabled = true;
    status.textContent = t('parking.loading');
    try {
      const result = await rpc('parking_list', { water_key: water.key });
      if (!host.isConnected) return;
      if (!Array.isArray(result?.points)) throw Error('Invalid parking list');
      render(result.points, true);
      status.textContent = '';
    } catch {
      if (host.isConnected) status.textContent = t('parking.offline');
    } finally {
      refresh.disabled = false;
    }
  }
  render([], false);
  refresh.onclick = load;
  await load();
}

/** Expose the private rating controls alongside the aggregate for this water. */
export async function waterRating(host, water) {
  const heading = '<h2>' + esc(t('rating.title')) + '</h2>';
  /** Refresh the current water's community information from the service. */
  async function load(operation = 'water_rating', args = {}) {
    host.setAttribute('aria-busy', 'true');
    try {
      const data = await rpc(operation, { water_key: water.key, ...args });
      if (!host.isConnected) return;
      if (!Number.isInteger(data?.count)) throw Error('Unexpected rating response');
      replaceMarkup(
        host,
        heading +
          '<p role="status">' +
          (data.count
            ? esc(Number(data.average).toLocaleString(languageTag)) +
              ' / 5 · ' +
              esc(t('common.ratings')) +
              ' ' +
              data.count
            : esc(t('common.no_ratings_yet'))) +
          '</p>' +
          selectField(
            'water-stars',
            t('rating.mine'),
            [['', t('rating.choose')], ...[1, 2, 3, 4, 5].map((n) => [String(n), n + ' / 5'])],
            String(data.mine ?? ''),
          ) +
          button('save-stars', t('rating.save'), 'secondary') +
          (data.mine ? button('clear-stars', t('rating.withdraw'), 'secondary') : ''),
      );
      const field = host.querySelector('select'),
        save = host.querySelector('#save-stars');
      save.disabled = true;
      field.onchange = () => (save.disabled = !field.value || Number(field.value) === data.mine);
      save.onclick = () => write(Number(field.value));
      if (data.mine) host.querySelector('#clear-stars').onclick = () => write(null);
    } catch (e) {
      if (!host.isConnected) return;
      replaceMarkup(
        host,
        heading +
          '<p role="status">' +
          esc(failure(e)) +
          '</p>' +
          button('retry-stars', t('common.retry'), 'secondary'),
      );
      host.querySelector('button').onclick = () => load();
    } finally {
      host.removeAttribute('aria-busy');
    }
  }
  /** Submit the revised water rating and refresh the displayed summary. */
  function write(stars) {
    host.querySelectorAll('select,button').forEach((el) => (el.disabled = true));
    load('water_rate', { stars });
  }
  await load();
}
