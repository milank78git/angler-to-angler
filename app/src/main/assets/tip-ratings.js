import { languageTag } from './i18n.js';
import { by, esc, t, confirmAction, submitChange, trackEdits, toast } from './ui.js';
import { rpc } from './profile-api.js';

const criteria = [
  ['accuracy', t('tip_ratings.accuracy_of_information')],
  ['technique', t('tip_ratings.technique_description')],
  ['match', t('tip_ratings.did_the_tip_deliver_what_the_author')],
];
const decimal = new Intl.NumberFormat(languageTag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Render the per-criterion score for the selected rating summary. */
function breakdown(scores, average = false) {
  return (
    '<dl class="rating-breakdown">' +
    criteria
      .map(
        ([key, label]) =>
          '<div><dt>' +
          esc(label) +
          '</dt><dd>' +
          (average ? decimal.format(scores[key]) : esc(scores[key])) +
          ' / 5</dd></div>',
      )
      .join('') +
    '</dl>'
  );
}

/** Show the number of contributing purchases alongside the score, including on offer previews. */
export function authorRating(summary, detailed = false) {
  if (!summary) return '';
  const title = t('tip_ratings.author_rating');
  const result = summary.count
    ? decimal.format(summary.average) + ' / 5 · ' + t('common.ratings') + ' ' + esc(summary.count)
    : t('common.no_ratings_yet');
  if (!detailed) return '<p class="meta author-rating">' + title + ' · ' + result + '</p>';
  return (
    '<section class="author-rating"><h2>' +
    title +
    '</h2><p>' +
    result +
    '</p>' +
    (summary.count ? breakdown(summary, true) : '') +
    '</section>'
  );
}

/** Show review controls for the buyer's purchase when the server allows it. */
export function purchaseRating(item) {
  if (!item.purchased || !('myRating' in item)) return '';
  if (item.myRating)
    return (
      '<section id="my-rating" class="surface"><h2>' +
      t('tip_ratings.your_rating') +
      '</h2>' +
      breakdown(item.myRating) +
      '</section>'
    );
  return (
    '<details class="surface fold" id="rating-editor"><summary>' +
    t('tip_ratings.rate_purchased_tip') +
    '</summary><form id="rating-form" class="fold-body"><p>' +
    t('tip_ratings.score_each_item_from_1_worst_to') +
    '</p>' +
    criteria
      .map(
        ([key, label]) =>
          '<fieldset class="rating-criterion"><legend>' +
          esc(label) +
          '</legend><div>' +
          [1, 2, 3, 4, 5]
            .map(
              (n) =>
                '<label><input required type="radio" name="' +
                key +
                '" value="' +
                n +
                '"><span>' +
                n +
                '</span></label>',
            )
            .join('') +
          '</div></fieldset>',
      )
      .join('') +
    '<button class="primary" id="submit-rating">' +
    t('tip_ratings.submit_rating') +
    '</button></form></details>'
  );
}

/** Submit the displayed purchase rating and recover the form after failure. */
export function bindPurchaseRating(view, nav, offerId) {
  const form = by('rating-form');
  if (!form) return;
  trackEdits(form, view);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const scores = criteria.map(([key]) => Number(values.get(key)));
    const confirmed = await confirmAction({
      title: t('tip_ratings.confirm_your_rating'),
      message:
        criteria.map(([, label], i) => label + ' ' + scores[i] + '/5').join(' · ') +
        '. ' +
        t('tip_ratings.you_can_rate_each_purchase_once'),
      accept: t('tip_ratings.confirm'),
    });
    if (!confirmed) return;
    await submitChange(
      view,
      () =>
        rpc('market_rate', {
          offer_id: offerId,
          accuracy: scores[0],
          technique: scores[1],
          preview_match: scores[2],
        }),
      () => {
        view.dirty = false;
        nav.show();
      },
      (err) => {
        if (err.status === 429) {
          toast(t('limits.hourly'));
        } else if (err.status === 409) {
          toast(t('tip_ratings.this_purchase_was_already_rated_loading_the'));
          nav.show();
        } else {
          toast(
            err.status === 422
              ? t('tip_ratings.choose_three_scores_from_1_to_5')
              : t('tip_ratings.could_not_confirm_submission_please_retry'),
          );
        }
      },
    );
  };
}
