import { insertMarkup, replaceMarkup } from './markup.js';
import {
  playEdition,
  commerceStatus,
  commerceBuy,
  purchaseFunding,
  commerceDiscover,
  commercePublish,
  enrollment,
  walletPanel,
  estimate,
} from './commerce.js';
import { waterPicker, bindWaterPicker } from './water-picker.js';
import {
  countryOptions,
  fishDirectory,
  fishOption,
  matchingSpecies,
  preferredCountry,
} from './fish-catalogue.js';
import {
  by,
  screen,
  esc,
  bind,
  back,
  bindBack,
  button,
  t,
  displayDay,
  field,
  textInput,
  selectField,
  confirmAction,
  trackEdits,
  submitChange,
  toast,
} from './ui.js';
import { authorRating, purchaseRating, bindPurchaseRating } from './tip-ratings.js';
import { rpc } from './profile-api.js';
import { newJournalId } from './journal.js';
import { today } from './domain.js';

const market = () => t('market.title');
const credits = (n) => t('market.credit_amount').replace('{count}', String(n));
const activate = () => t('market.claim_100_test_credits');
const access = () => ({
  shore: t('market.from_shore'),
  boat: t('market.from_a_boat'),
  both: t('market.shore_or_boat'),
});
const shelves = () => ({
  browse: t('market.available'),
  purchased: t('market.purchased_tips'),
  mine: t('market.my_offers'),
});
const editLabel = () => t('market.edit_offer');
const waterName = (directory, key) => directory.byKey.get(key)?.name || '';
const heading = (title) => back(t('common.back')) + '<h1>' + esc(title) + '</h1>';

function errorText(status) {
  if (status === 429) return t('limits.hourly');
  if (status === 401 || status === 403) return t('market.sign_in_with_a_verified_account');
  if (status === 404) return t('market.this_offer_is_no_longer_available');
  if (status === 409) return t('market.the_terms_or_remaining_availability_changed_review');
  if (status === 402) return t('market.you_have_too_few_test_credits_for');
  if (status === 422) return t('market.check_the_offer_details');
  return t('market.connection_failed_please_retry');
}

function loadError(view, nav, err) {
  if (!view.active()) return;
  replaceMarkup(
    screen,
    heading(market()) +
      '<p role="alert">' +
      errorText(err.status) +
      '</p>' +
      button('market-reload', t('common.refresh'), 'secondary'),
  );
  bindBack(nav);
  bind('market-reload', () => nav.show());
}

/** Ratings describe buyers' experiences with this tip and all of its author's tips separately. */
function offerFacts(item, waterDirectory, directory) {
  const fish = directory.names.get(item.species);
  const score = item.offerRating;
  const tipRating = !score
    ? ''
    : '<p class="meta">' +
      t('market.this_tips_rating') +
      ' · ' +
      (score.count
        ? esc(score.average) + ' / 5 · ' + t('common.ratings') + ' ' + esc(score.count)
        : t('common.no_ratings_yet')) +
      '</p>';
  const remaining =
    item.limit == null ? t('market.unlimited') : t('market.remaining') + Math.max(0, item.limit - item.sold);
  return (
    '<p>' +
    [
      fish?.label || item.species,
      access()[item.access],
      displayDay(item.day),
      waterName(waterDirectory, item.water),
    ]
      .filter(Boolean)
      .map(esc)
      .join(' · ') +
    '</p><p class="meta">' +
    [
      item.author,
      t('market.sold') + (item.sales ?? item.sold),
      item.pilotCopies ? t('commerce.pilot_copies').replace('{count}', String(item.pilotCopies)) : '',
      item.withdrawn ? t('market.withdrawn') : remaining,
    ]
      .filter(Boolean)
      .map(esc)
      .join(' · ') +
    '</p><strong>' +
    credits(item.price) +
    '</strong>' +
    tipRating +
    authorRating(item.authorRating)
  );
}

function claim(view, nav) {
  bind('market-activate', () =>
    submitChange(
      view,
      () => rpc('market_activate'),
      () => nav.show(),
      (err) => toast(errorText(err.status)),
    ),
  );
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function marketShelf({ view, nav, waterDirectory }) {
  const { shelf = 'browse', cursor = null, water = null } = view.route;
  const play = playEdition();
  const tabs =
    '<div class="actions">' +
    Object.entries(shelves())
      .map(([key, label]) => button('shelf-' + key, label, shelf === key ? 'primary' : 'secondary'))
      .join('') +
    '</div>';
  function bindShelves() {
    for (const key of Object.keys(shelves())) {
      by('shelf-' + key).setAttribute('aria-pressed', String(key === shelf));
      bind('shelf-' + key, () => {
        view.route.shelf = key;
        view.route.cursor = null;
        nav.show();
      });
    }
  }
  // The purchased shelf remains reachable while discovery or billing is still responding.
  replaceMarkup(screen, heading(market()) + tabs);
  bindBack(nav);
  bindShelves();
  const catalogue =
    shelf === 'browse'
      ? play
        ? commerceDiscover(water, cursor)
        : rpc('market_discover', { water_key: water, before_position: cursor })
      : rpc('market_list', { shelf, before_position: cursor });
  const [page, directory, wallet] = await Promise.all([
    catalogue.then(
      (data) => ({ data, error: null }),
      (error) => ({ error, data: null }),
    ),
    fishDirectory().catch(() => ({ names: new Map() })),
    play && shelf === 'browse' ? commerceStatus().catch(() => null) : null,
  ]);
  if (!view.active()) return;
  if (page.error) {
    insertMarkup(
      screen,
      'beforeend',
      '<p role="alert">' +
        esc(errorText(page.error.status)) +
        '</p>' +
        button('market-reload', t('common.refresh'), 'secondary'),
    );
    bind('market-reload', () => nav.show());
    return;
  }
  const { data } = page;
  let walletSummary = '';
  if (!play) {
    walletSummary =
      '<p>' +
      t('market.fishing_techniques_for_test_credits_credits_have') +
      '</p>' +
      (data.balance == null
        ? button('market-activate', activate(), 'secondary')
        : '<p>' + t('market.balance') + ' · ' + credits(data.balance) + '</p>');
  } else if (shelf === 'browse') {
    walletSummary = wallet ? '<section class="surface" id="commerce-wallet"></section>' : walletUnavailable();
  }
  replaceMarkup(
    screen,
    heading(market()) +
      walletSummary +
      tabs +
      (shelf === 'browse'
        ? waterPicker('market-water', t('common.water'), t('market.all_waters')) +
          '<p id="market-stats">' +
          [
            [t('market.active_offers'), data.stats.offers],
            [t('market.tip_authors'), data.stats.authors],
            [t('market.purchases_of_active_tips'), data.stats.sales],
            [t('market.buyer_ratings'), data.stats.ratings],
          ]
            .map(([label, n]) => esc(label) + ' · ' + esc(n))
            .join(' / ') +
          '</p>'
        : '') +
      '<h2>' +
      shelves()[shelf] +
      '</h2>' +
      (data.items
        .map(
          (item, i) =>
            '<article class="surface"><h3>' +
            esc(item.title) +
            '</h3>' +
            offerFacts(item, waterDirectory, directory) +
            button('offer-' + i, t('market.open_tip'), 'secondary') +
            '</article>',
        )
        .join('') || '<p class="empty">' + t('common.no_tips_here_yet') + '</p>') +
      (data.next ? button('market-more', t('market.more_tips'), 'secondary') : '') +
      (play && (!wallet || wallet.mode === 'off')
        ? ''
        : button('market-create', t('common.offer_a_technique'), 'primary')),
  );
  bindBack(nav);
  if (shelf === 'browse') bindWaterPicker('market-water', view, waterDirectory, water);
  if (by('market-water'))
    by('market-water').onchange = () => {
      view.route.water = by('market-water').value || null;
      view.route.cursor = null;
      nav.show();
    };
  if (wallet) walletPanel(view, nav, wallet);
  if (by('wallet-refresh')) bind('wallet-refresh', () => nav.show());
  if (!play && data.balance == null) claim(view, nav);
  bindShelves();
  data.items.forEach((item, i) => bind('offer-' + i, () => nav.open('marketDetail', { id: item.id })));
  if (data.next) bind('market-more', () => nav.open('marketShelf', { shelf, water, cursor: data.next }));
  if (by('market-create')) bind('market-create', () => nav.open('marketEditor', { water }));
}

function walletUnavailable() {
  return (
    '<p role="status">' +
    esc(t('commerce.quote_unavailable')) +
    '</p>' +
    button('wallet-refresh', t('common.refresh'), 'secondary')
  );
}

/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function marketDetail({ view, nav, waterDirectory }) {
  const { id } = view.route;
  const play = playEdition();
  let item, directory;
  try {
    [item, directory] = await Promise.all([
      rpc('market_detail', { offer_id: id }),
      fishDirectory().catch(() => ({ names: new Map() })),
    ]);
  } catch (err) {
    return loadError(view, nav, err);
  }
  if (!view.active()) return;
  const wallet = play && !item.purchased ? await commerceStatus(id).catch(() => null) : null;
  if (!view.active()) return;
  const balance = play ? wallet?.balance : item.balance;
  const funding = purchaseFunding(wallet, item.price, item.limit);
  const affordable = play ? funding?.available : balance >= item.price;
  const payment = funding
    ? t('commerce.purchase_funding')
        .replace('{welcome}', String(funding.welcome))
        .replace('{paid}', String(funding.paid))
    : '';
  const inStock = !item.withdrawn && (item.limit == null || item.limit > item.sold);
  const available =
    inStock && (play ? wallet?.enrolled && wallet.mode !== 'off' && funding : !item.commercial);
  replaceMarkup(
    screen,
    heading(item.title) +
      '<article class="surface"><h2>' +
      t('market.fishing_technique') +
      '</h2>' +
      offerFacts(item, waterDirectory, directory) +
      '</article>' +
      (item.mine || item.purchased
        ? '<section class="surface"><h2>' +
          (item.mine ? t('market.your_technique') : t('market.purchased_technique')) +
          '</h2><p class="discussion-body" id="market-technique">' +
          esc(item.technique) +
          '</p></section>'
        : '<p>' + t('market.unlock_the_authors_written_technique') + '</p>') +
      (wallet && !wallet.enrolled && !item.purchased ? '<p>' + t('commerce.pilot_offer') + '</p>' : '') +
      (wallet && item.mine && !item.withdrawn && !wallet.enrolled && wallet.mode !== 'off'
        ? button('commerce-enroll', t('commerce.enroll'), 'secondary')
        : '') +
      (wallet && wallet.enrolled
        ? '<p>' + t('commerce.split') + (item.mine ? ' ' + estimate(item.price) : '') + '</p>'
        : '') +
      (play &&
      !item.mine &&
      !item.purchased &&
      (!wallet || (wallet.mode !== 'off' && wallet.enrolled && !funding))
        ? walletUnavailable()
        : '') +
      (!play && item.commercial && !item.mine && !item.purchased
        ? '<p>' + esc(t('commerce.play_offer')) + '</p>'
        : '') +
      (item.welcomeOnly ? '<p>' + esc(t('commerce.welcome_access')) + '</p>' : '') +
      purchaseRating(item) +
      '<div class="actions">' +
      (item.mine && !item.withdrawn
        ? button('market-edit', editLabel(), 'secondary') +
          button('market-withdraw', t('market.withdraw_offer'), 'danger')
        : !item.mine && !item.purchased && available
          ? balance == null
            ? button('market-activate', activate(), 'secondary')
            : '<p>' +
              t('market.balance') +
              ' · ' +
              credits(balance) +
              '</p>' +
              (affordable
                ? button('market-buy', t('market.unlock_tip'), 'primary')
                : '<p>' +
                  (wallet
                    ? item.limit != null && balance >= item.price
                      ? t('commerce.limited_paid')
                      : t('commerce.insufficient')
                    : errorText(402)) +
                  '</p>')
          : '') +
      '</div>',
  );
  bindBack(nav);
  if (by('wallet-refresh')) bind('wallet-refresh', () => nav.show());
  enrollment(view, nav, item);
  bindPurchaseRating(view, nav, id);
  if (by('market-activate')) claim(view, nav);
  if (by('market-edit')) bind('market-edit', () => nav.open('marketEditor', { id }));
  if (by('market-withdraw'))
    bind('market-withdraw', async () => {
      if (
        !(await confirmAction({
          title: t('market.withdraw_offer_label'),
          message: t('market.existing_buyers_keep_their_purchased_version'),
          accept: t('market.withdraw'),
          destructive: true,
        }))
      )
        return;
      await submitChange(
        view,
        () => rpc('market_withdraw', { offer_id: id }),
        () => nav.show(),
        (err) => toast(errorText(err.status)),
      );
    });
  if (by('market-buy'))
    bind('market-buy', async () => {
      if (
        !(await confirmAction({
          title: t('market.confirm_tip_purchase'),
          message: [
            item.title,
            credits(item.price),
            payment,
            funding?.paid === 0 ? t('commerce.welcome_access') : '',
          ]
            .filter(Boolean)
            .join(' · '),
          accept: t('market.buy_for') + credits(item.price),
        }))
      )
        return;
      await submitChange(
        view,
        () =>
          wallet
            ? commerceBuy(id, item.revision, item.price, funding?.paid)
            : rpc('market_buy', {
                offer_id: id,
                expected_revision: item.revision,
                expected_price: item.price,
              }),
        () => nav.show(),
        (err) => {
          toast(play && err.status === 402 ? t('commerce.insufficient') : errorText(err.status));
          if ([402, 404, 409].includes(err.status)) nav.show();
        },
      );
    });
}

/** An author explicitly writes the unlocked text. No notes, photos or coordinates are copied from a trip. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function marketEditor({ view, nav, waterDirectory }) {
  const route = view.route;
  let old, directory;
  try {
    directory = await fishDirectory();
    if (route.id) old = await rpc('market_detail', { offer_id: route.id });
  } catch (err) {
    return loadError(view, nav, err);
  }
  if (!view.active()) return;
  if (route.id && (!old.mine || old.withdrawn)) return loadError(view, nav, { status: 404 });
  route.requestId ??= newJournalId();
  const commercialTerms = old ? old.commercial === true : playEdition();
  const initialWater = old?.water ?? route.water;
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zoneOf = (water) => water?.zone || deviceZone;
  const currentDay = today(zoneOf(waterDirectory.byKey.get(initialWater)));
  replaceMarkup(
    screen,
    heading(old ? editLabel() : t('common.offer_a_technique')) +
      '<form id="market-form" class="entry-form"><fieldset class="surface"><legend>' +
      t('market.public_preview') +
      '</legend>' +
      textInput('offer-title', t('market.technique_title'), old?.title, 'required maxlength="80"') +
      selectField(
        'offer-country',
        t('market.fish_catalogue_country'),
        countryOptions(directory),
        preferredCountry(directory),
      ) +
      textInput('species-filter', t('market.search_the_fish_catalogue'), '', 'type="search"') +
      field('offer-species', t('market.target_fish'), '<select id="offer-species" required></select>') +
      textInput(
        'offer-day',
        t('market.date_fished'),
        old?.day ?? route.day ?? currentDay,
        'required type="date" min="1900-01-01" max="' + currentDay + '"',
      ) +
      waterPicker('offer-water', t('market.water_shown_in_preview'), t('market.omit')) +
      selectField(
        'offer-access',
        t('market.where_to_fish'),
        Object.entries(access()),
        old?.access ?? 'shore',
      ) +
      textInput(
        'offer-price',
        t(commercialTerms ? 'commerce.price' : 'market.price_in_test_credits'),
        old?.price ?? 10,
        'required type="number" min="1" max="100"',
      ) +
      textInput(
        'offer-limit',
        t('market.total_sales_limit_optional'),
        old?.limit ?? '',
        'type="number" min="' + Math.max(1, old?.sold || 0) + '" max="10000"',
      ) +
      '</fieldset><fieldset class="surface"><legend>' +
      t('market.only_for_buyers') +
      '</legend>' +
      field(
        'offer-technique',
        t('market.written_technique'),
        '<textarea required minlength="10" maxlength="2000" rows="5" id="offer-technique">' +
          esc(old?.technique) +
          '</textarea>',
      ) +
      '</fieldset><button id="market-preview" class="primary">' +
      t('market.review_offer') +
      '</button></form>',
  );
  bindBack(nav);
  const selectedWater = bindWaterPicker('offer-water', view, waterDirectory, initialWater);
  const dayInput = by('offer-day');
  let automaticDay = !old?.day && !route.day;
  dayInput.addEventListener('input', () => {
    automaticDay = false;
  });
  function updateDay() {
    dayInput.max = today(zoneOf(selectedWater()));
    if (automaticDay) dayInput.value = dayInput.max;
  }
  by('offer-water').addEventListener('change', updateDay);
  by('offer-water-search').addEventListener('input', updateDay);
  dayInput.addEventListener('focus', updateDay);
  by('market-preview').addEventListener('click', updateDay);
  const picker = by('offer-species');
  const country = by('offer-country');
  const search = by('species-filter');
  function choices(selected) {
    const items = matchingSpecies(directory, country.value, search.value);
    picker.replaceChildren(new Option(t('market.choose_a_catalogue_species'), ''));
    // An author can keep a historical species while editing other offer details.
    if (
      selected &&
      selected === old?.species &&
      !search.value.trim() &&
      !items.some((fish) => fish.latin === selected)
    ) {
      const fish = directory.names.get(selected);
      picker.add(
        new Option(t('market.saved_species') + ' · ' + (fish ? fishOption(fish) : selected), selected),
      );
    }
    for (const fish of items) picker.add(new Option(fishOption(fish), fish.latin));
    picker.value = selected;
    if (picker.selectedIndex < 0) picker.selectedIndex = 0;
  }
  choices(old?.species || '');
  search.oninput = () => choices(picker.value);
  country.onchange = () => {
    localStorage.setItem('fish.country', country.value);
    window.dispatchEvent(new Event('journal-edited'));
    choices(picker.value);
  };
  const form = by('market-form');
  trackEdits(form, view);
  form.onsubmit = (event) => {
    event.preventDefault();
    const val = (id) =>
      /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (
        by('offer-' + id)
      ).value.trim();
    const draft = {
      title: val('title'),
      species: val('species'),
      day: val('day'),
      timeZone: zoneOf(selectedWater()),
      access: val('access'),
      water: val('water') || null,
      price: Number(val('price')),
      limit: val('limit') ? Number(val('limit')) : null,
      technique: val('technique'),
    };
    if (!draft.title || !draft.species || draft.technique.length < 10) return toast(errorText(422));
    review(draft);
  };
  async function review(draft) {
    const commercial = playEdition() && !old;
    const message = [
      draft.title,
      draft.species,
      displayDay(draft.day),
      access()[draft.access],
      selectedWater()?.name || draft.water,
      credits(draft.price),
      draft.limit == null ? t('market.unlimited') : t('market.sales_limit') + draft.limit,
    ]
      .filter(Boolean)
      .join(' · ');
    if (
      !(await confirmAction({
        title: t('market.publish_this_preview'),
        message: commercialTerms
          ? message + ' · ' + t('commerce.split') + ' ' + estimate(draft.price)
          : message,
        accept: t(commercial ? 'commerce.review_sale' : 'market.publish_offer'),
      }))
    )
      return;
    const args = { offer_id: old?.id ?? route.requestId, expected_revision: old?.revision ?? 0, draft };
    await submitChange(
      view,
      () => (commercial ? commercePublish(args) : rpc('market_publish', args)),
      () => {
        view.dirty = false;
        toast(t('market.offer_saved'));
        nav.back();
      },
      (err) => {
        toast(errorText(err.status));
        if (err.status === 409 && !by('market-refresh-editor')) {
          insertMarkup(
            form,
            'afterend',
            button('market-refresh-editor', t('market.load_current_offer'), 'secondary'),
          );
          bind('market-refresh-editor', () => nav.leave(() => nav.show()));
        }
      },
    );
  }
}
