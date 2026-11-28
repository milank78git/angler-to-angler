import { replaceMarkup } from './markup.js';
import { screen, by, t, esc, button, back, bindBack, bind, toast, confirmAction } from './ui.js';
import { today } from './domain.js';
import { Journal } from './journal.js';
import { showError } from './profiles.js';
import { rpc, failure, photoPayload } from './profile-api.js';

const outcomes = {
  pending: t('verification.awaiting_review'),
  measured: t('verification.length_read_from_ruler'),
  estimated: t('verification.length_estimated_from_a_reference'),
  unverified: t('verification.insufficient_evidence'),
};
const labels = {
  submit: t('verification.catch.photo.review'),
  withdraw: t('verification.remove_review_record'),
};

/** Offer an eligible catch for review with a preview of the evidence being sent. */
export function addVerificationAction(article, record, trip, view, nav) {
  const action = document.createElement('button');
  action.className = 'secondary';
  if (
    !record.capture ||
    !record.hasPhoto ||
    today(trip.zone, new Date(record.capture.captured)) !== trip.day
  ) {
    const label = document.createElement('p');
    label.className = 'meta';
    label.textContent = t('verification.photo_not_reviewed');
    article.append(label);
    return;
  }
  action.dataset.verifyCatch = record.id;
  action.textContent = labels.submit;
  action.onclick = async () => {
    action.disabled = true;
    try {
      const previous = await rpc('evidence_list', { before_time: null, before_id: null, only_id: record.id });
      if (!view.active()) return;
      if (previous.items.length) {
        nav.open('evidence', { onlyId: record.id });
        return;
      }
      const consent = await confirmAction({
        title: t('verification.send_photo_for_review'),
        message: t('verification.the_reviewer_will_see_the_catch_photo'),
        accept: t('verification.send_for_review'),
        catchPreview: {
          species: record.speciesName,
          water: trip.waterName,
          url: article.querySelector('.preview')?.src,
        },
      });
      if (!view.active()) return;
      if (!consent) {
        action.disabled = false;
        action.focus({ preventScroll: true });
        return;
      }
      const capture = record.capture;
      const photo = await photoPayload(await Journal.photo(record.id), 1200, 184320);
      if (!view.active()) return;
      await rpc('evidence_submit', {
        catch_id: record.id,
        species: record.speciesName,
        water: trip.waterName,
        trip_day: trip.day,
        trip_zone: trip.zone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        captured: capture.captured,
        fixed: capture.fixed,
        lat100: capture.lat,
        lon100: capture.lon,
        accuracy: capture.accuracy,
        photo,
      });
      if (view.active()) nav.open('evidence', { onlyId: record.id });
    } catch (error) {
      if (view.active()) {
        toast(failure(error));
        if (error.status === 401) nav.open('anglerProfile');
      }
    } finally {
      action.disabled = false;
    }
  };
  article.append(action);
}

/** Distinguish a measured length from an estimate or other review outcome. */
function reviewResult({ outcome, mm }) {
  if (outcome !== 'measured' && outcome !== 'estimated') {
    return '<strong>' + esc(outcomes[outcome]) + '</strong>';
  }
  const cm = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 }).format(
    mm / 10,
  );
  return (
    '<strong>' +
    t('verification.photo_documented') +
    '</strong><p>' +
    outcomes[outcome] +
    ' · ' +
    esc(cm) +
    ' cm</p>'
  );
}

/** Format the capture timestamp in the selected app language. */
function localTime(value) {
  return new Date(value).toLocaleString(document.documentElement.lang);
}

/** List the signed-in angler's evidence and the controls available for each catch.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function evidenceScreen({ view, nav }) {
  let page;
  try {
    page = await rpc('evidence_list', {
      before_time: view.route.time || null,
      before_id: view.route.id || null,
      only_id: view.route.onlyId || null,
    });
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      (view.route.onlyId ? t('verification.catch_photo_review') : t('common.my_submitted_catch_photos')) +
      '</h1>' +
      '<p>' +
      t('verification.a_catch_counts_once_a_reviewer_can') +
      '</p>' +
      (page.reviewer ? button('review', t('verification.review_submitted_photos'), 'primary') : '') +
      '<div class="profile-directory">' +
      (page.items
        .map(
          (item) =>
            '<article class="surface"><h2>' +
            esc(item.species) +
            '</h2><p>' +
            esc(localTime(item.captured)) +
            '</p>' +
            reviewResult(item) +
            '<div><button class="secondary" data-remove="' +
            esc(item.id) +
            '">' +
            labels.withdraw +
            '</button></div></article>',
        )
        .join('') ||
        '<p>' +
          (view.route.onlyId
            ? t('verification.there_is_no_submission_for_this_catch')
            : t('verification.no_submitted_photos_you_can_send_a')) +
          '</p>') +
      '</div>' +
      (page.more ? button('more', t('verification.older_records'), 'secondary') : '') +
      button('refresh-evidence', t('common.refresh'), 'secondary'),
  );
  bindBack(nav);
  bind('refresh-evidence', () => nav.show());
  if (page.reviewer) bind('review', () => nav.open('review'));
  if (page.more)
    bind('more', () => {
      const last = page.items[page.items.length - 1];
      nav.open('evidence', { time: last.submitted, id: last.id });
    });
  /** @type {NodeListOf<HTMLButtonElement>} */ (screen.querySelectorAll('[data-remove]')).forEach(
    (b) =>
      (b.onclick = async () => {
        const confirmed = await confirmAction({
          title: t('verification.remove_review_record_label'),
          message: t('verification.the_catch_stays_in_your_journal_if'),
          accept: t('verification.remove_record'),
          destructive: true,
        });
        if (!view.active() || !confirmed) return;
        b.disabled = true;
        try {
          await rpc('evidence_remove', { catch_id: b.dataset.remove });
          if (view.active()) nav.show();
        } catch (error) {
          if (view.active()) toast(failure(error));
          b.disabled = false;
        }
      }),
  );
}

/** Load the evidence assigned to the reviewer before enabling a decision.
 * @param {import('../../../../types/screens.js').ScreenContext} context
 */
export async function reviewScreen({ view, nav }) {
  let item;
  try {
    ({ item } = await rpc('evidence_review'));
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  replaceMarkup(
    screen,
    back(t('common.back')) +
      '<h1>' +
      t('verification.photo.review') +
      '</h1>' +
      (item
        ? '<article class="surface"><h2>' +
          esc(item.species) +
          '</h2><p>' +
          esc(localTime(item.captured)) +
          ' · ' +
          esc(item.water) +
          ' · ' +
          esc(item.lat100 / 100) +
          ', ' +
          esc(item.lon100 / 100) +
          '</p><img class="review-image" alt="' +
          esc(t('verification.catch_photograph')) +
          '" src="data:image/jpeg;base64,' +
          esc(item.photo) +
          '"></article>' +
          '<form id="decision" class="entry-form"><section class="surface"><label for="outcome">' +
          t('verification.review_outcome') +
          '</label><select id="outcome" required><option value="">—</option><option value="measured">' +
          outcomes.measured +
          '</option><option value="estimated">' +
          outcomes.estimated +
          '</option><option value="unverified">' +
          outcomes.unverified +
          '</option></select>' +
          '<small>' +
          t('verification.compare_the_capture_location_with_the_reported') +
          '</small>' +
          '<label for="review-length">' +
          t('verification.length_from_photo_cm') +
          '</label><input id="review-length" type="number" min="0.1" max="2000" step="0.1" required></section>' +
          '<button class="primary">' +
          t('verification.save_decision') +
          '</button></form>'
        : '<p>' + t('verification.no_other_anglers_photos_are_awaiting_review') + '</p>'),
  );
  bindBack(nav);
  if (!item) return;
  const length = by('review-length');
  by('outcome').onchange = () => {
    length.disabled = by('outcome').value === 'unverified';
    length.required = !length.disabled;
  };
  by('decision').onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving) return;
    view.saving = true;
    const outcome = by('outcome').value;
    try {
      await rpc('evidence_decide', {
        owner_id: item.owner,
        catch_id: item.id,
        outcome,
        length_mm: outcome === 'unverified' ? null : Math.round(Number(length.value) * 10),
      });
    } catch (error) {
      toast(failure(error));
    } finally {
      view.saving = false;
      if (view.active()) nav.show();
    }
  };
}
