import { by, cs, esc, t, confirmAction, submitChange, trackEdits, toast } from './ui.js';
import { rpc } from './profile-api.js';

const criteria = [
  ['accuracy', t('Přesnost údajů', 'Accuracy of information')],
  ['technique', t('Popis techniky', 'Technique description')],
  ['match', t('Soulad s náhledem', 'Match with preview')],
];
const decimal = new Intl.NumberFormat(cs ? 'cs-CZ' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function breakdown(scores, average = false) {
  return '<dl class="rating-breakdown">' + criteria.map(([key, label]) =>
    '<div><dt>' + esc(label) + '</dt><dd>' + (average ? decimal.format(scores[key]) : esc(scores[key])) + ' / 5</dd></div>',
  ).join('') + '</dl>';
}

/** Show the number of contributing purchases alongside the score, including on offer previews. */
export function authorRating(summary, detailed = false) {
  if (!summary) return '';
  const title = t('Hodnocení autora', 'Author rating');
  const result = summary.count
    ? decimal.format(summary.average) + ' / 5 · ' + t('Počet hodnocení', 'Ratings') + ' ' + esc(summary.count)
    : t('Zatím bez hodnocení', 'No ratings yet');
  if (!detailed) return '<p class="meta author-rating">' + title + ' · ' + result + '</p>';
  return '<section class="author-rating"><h2>' + title + '</h2><p>' + result + '</p>' +
    (summary.count ? breakdown(summary, true) : '') + '</section>';
}

export function purchaseRating(item) {
  if (!item.purchased || !('myRating' in item)) return '';
  if (item.myRating) return '<section id="my-rating" class="surface"><h2>' +
    t('Tvoje hodnocení', 'Your rating') + '</h2>' + breakdown(item.myRating) + '</section>';
  return '<details class="surface fold" id="rating-editor"><summary>' + t('Ohodnotit zakoupený tip', 'Rate purchased tip') +
    '</summary><form id="rating-form" class="fold-body"><p>' +
    t('Každou položku ohodnoť od 1 (nejhorší) do 5 (nejlepší).', 'Score each item from 1 (worst) to 5 (best).') +
    '</p>' + criteria.map(([key, label]) =>
      '<fieldset class="rating-criterion"><legend>' + esc(label) + '</legend><div>' +
      [1, 2, 3, 4, 5].map(n => '<label><input required type="radio" name="' + key + '" value="' + n + '"><span>' +
        n + '</span></label>').join('') + '</div></fieldset>',
    ).join('') + '<button class="primary" id="submit-rating">' + t('Odeslat hodnocení', 'Submit rating') + '</button></form></details>';
}

export function bindPurchaseRating(view, nav, offerId) {
  const form = by('rating-form');
  if (!form) return;
  trackEdits(form, view);
  form.onsubmit = async event => {
    event.preventDefault();
    const values = new FormData(form);
    const scores = criteria.map(([key]) => Number(values.get(key)));
    const confirmed = await confirmAction({
      title: t('Potvrdit hodnocení?', 'Confirm your rating?'),
      message: criteria.map(([, label], i) => label + ' ' + scores[i] + '/5').join(' · ') + '. ' +
        t('Hodnocení lze odeslat jen jednou.', 'You can rate each purchase once.'),
      accept: t('Potvrdit', 'Confirm'),
    });
    if (!confirmed) return;
    await submitChange(view,
      () => rpc('market_rate', { offer_id: offerId, accuracy: scores[0], technique: scores[1], preview_match: scores[2] }),
      () => { view.dirty = false; nav.show(); },
      err => {
        if (err.status === 409) {
          toast(t('Tento nákup už má hodnocení. Načítám uložené známky.', 'This purchase was already rated. Loading the saved scores.'));
          nav.show();
        } else {
          toast(err.status === 422
            ? t('Vyber tři známky od 1 do 5.', 'Choose three scores from 1 to 5.')
            : t('Odeslání se nepodařilo ověřit. Zkus to znovu.', 'Could not confirm submission. Please retry.'));
        }
      });
  };
}
