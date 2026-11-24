import { countryOptions, fishDirectory, fishOption, matchingSpecies, preferredCountry } from './fish-catalogue.js';
import { by, screen, esc, bind, back, bindBack, button, t, displayDay, field, textInput, selectField,
  confirmAction, trackEdits, submitChange, toast } from './ui.js';
import { authorRating, purchaseRating, bindPurchaseRating } from './tip-ratings.js';
import { rpc } from './profile-api.js';
import { newJournalId } from './journal.js';
import { fold, today } from './domain.js';

const market = () => t('Tržiště tipů', 'Tip market');
const credits = n => t(n + ' test. kr.', n + ' test credits');
const activate = () => t('Získat 100 testovacích kreditů', 'Claim 100 test credits');
const access = () => ({
  shore: t('Ze břehu', 'From shore'), boat: t('Z lodě', 'From a boat'), both: t('Ze břehu i z lodě', 'Shore or boat'),
});
const shelves = () => ({
  browse: t('K dispozici', 'Available'), purchased: t('Zakoupené tipy', 'Purchased tips'), mine: t('Moje nabídky', 'My offers'),
});
const editLabel = () => t('Upravit nabídku', 'Edit offer');
const waterName = (directory, key) => directory.byKey.get(key)?.name || '';
function waterPicker(id, label, emptyLabel) {
  return textInput(id + '-search', t('Hledat revír podle názvu nebo čísla', 'Find a water by name or number'), '', 'type="search"') +
    selectField(id, label, [['', emptyLabel]], '');
}

/** Keep a selected water visible while narrowing the choices by name, number or organisation. */
function bindWaterPicker(id, directory, value) {
  const search = by(id + '-search'), select = by(id);
  const empty = select.options[0].text;
  function populate(selected) {
    const query = fold(search.value);
    const options = [new Option(empty, '')];
    for (const w of directory.waters) {
      if (w.country !== 'CZ') continue;
      if (w.key === selected || fold(w.name + ' ' + w.number + ' ' + w.area).includes(query)) {
        options.push(new Option(w.name + ' · ' + w.number, w.key));
      }
    }
    // Retain the identity of offers from an earlier catalogue revision.
    if (selected && !directory.byKey.has(selected)) options.push(new Option(selected, selected));
    select.replaceChildren(...options);
    select.value = selected || '';
  }
  populate(value);
  search.oninput = () => populate(select.value);
}
const heading = title => back(t('Zpět', 'Back')) + '<h1>' + esc(title) + '</h1>';

function errorText(status) {
  if (status === 401 || status === 403) return t('Přihlas se k ověřenému účtu.', 'Sign in with a verified account.');
  if (status === 404) return t('Nabídka už není dostupná.', 'This offer is no longer available.');
  if (status === 409) return t('Podmínky nebo počet zbývajících tipů se změnily. Zkontroluj aktuální nabídku.',
    'The terms or remaining availability changed. Review the current offer.');
  if (status === 402) return t('Na tento tip nemáš dost testovacích kreditů.', 'You have too few test credits for this tip.');
  if (status === 422) return t('Zkontroluj údaje nabídky.', 'Check the offer details.');
  return t('Spojení se nezdařilo. Zkus to znovu.', 'Connection failed. Please retry.');
}

function loadError(view, nav, err) {
  if (!view.active()) return;
  screen.innerHTML = heading(market()) + '<p role="alert">' + errorText(err.status) + '</p>' +
    button('market-reload', t('Obnovit', 'Refresh'), 'secondary');
  bindBack(nav);
  bind('market-reload', () => nav.show());
}

/** Ratings describe buyers' experiences with this tip and all of its author's tips separately. */
function offerFacts(item, waterDirectory, directory) {
  const fish = directory.names.get(item.species);
  const score = item.offerRating;
  const tipRating = !score ? '' : '<p class="meta">' + t('Hodnocení tohoto tipu','This tip’s rating') + ' · ' +
    (score.count ? esc(score.average) + ' / 5 · ' + t('Počet hodnocení','Ratings') + ' ' + esc(score.count) :
      t('Zatím bez hodnocení','No ratings yet')) + '</p>';
  const remaining = item.limit == null ? t('Bez limitu', 'Unlimited') :
    t('Zbývá ', 'Remaining ') + Math.max(0, item.limit - item.sold);
  return '<p>' + [fish?.label || item.species, access()[item.access], displayDay(item.day), waterName(waterDirectory, item.water)]
    .filter(Boolean).map(esc).join(' · ') + '</p><p class="meta">' +
    [item.author, t('Prodáno ', 'Sold ') + item.sold, item.withdrawn ? t('Staženo', 'Withdrawn') : remaining]
      .filter(Boolean).map(esc).join(' · ') + '</p><strong>' + credits(item.price) + '</strong>' + tipRating + authorRating(item.authorRating);
}

function claim(view, nav) {
  bind('market-activate', () => submitChange(view, () => rpc('market_activate'), () => nav.show(),
    err => toast(errorText(err.status))));
}

export async function marketShelf({ view, nav, waterDirectory }) {
  const { shelf = 'browse', cursor = null, water = null } = view.route;
  let data, directory;
  try {
    [directory,data] = await Promise.all([fishDirectory(), shelf === 'browse' ?
      rpc('market_discover', { water_key: water, before_position: cursor }) :
      rpc('market_list', { shelf, before_position: cursor })]);
  }
  catch (err) { return loadError(view, nav, err); }
  if (!view.active()) return;
  screen.innerHTML = heading(market()) +
    '<p>' + t('Rybářské techniky za testovací kredity. Kredity nemají peněžní hodnotu.',
      'Fishing techniques for test credits. Credits have no cash value.') + '</p>' +
    (data.balance == null ? button('market-activate', activate(), 'secondary') :
      '<p>' + t('Zůstatek', 'Balance') + ' · ' + credits(data.balance) + '</p>') +
    '<div class="actions">' + Object.entries(shelves()).map(([key, label]) =>
      button('shelf-' + key, label, shelf === key ? 'primary' : 'secondary')).join('') + '</div>' +
    (shelf === 'browse' ? waterPicker('market-water', t('Revír', 'Water'), t('Všechny revíry', 'All waters')) +
      '<p id="market-stats">' + [[t('Aktivní nabídky','Active offers'),data.stats.offers],
        [t('Autoři tipů','Tip authors'),data.stats.authors],[t('Nákupy aktivních tipů','Purchases of active tips'),data.stats.sales],
        [t('Hodnocení kupujících','Buyer ratings'),data.stats.ratings]].map(([label,n]) => esc(label)+' · '+esc(n)).join(' / ') + '</p>' : '') +
    '<h2>' + shelves()[shelf] + '</h2>' + (data.items.map((item, i) =>
      '<article class="surface"><h3>' + esc(item.title) + '</h3>' + offerFacts(item, waterDirectory, directory) +
      button('offer-' + i, t('Otevřít tip', 'Open tip'), 'secondary') + '</article>').join('') ||
      '<p class="empty">' + t('Zatím tu nejsou žádné tipy.', 'No tips here yet.') + '</p>') +
    (data.next ? button('market-more', t('Další tipy', 'More tips'), 'secondary') : '') +
    button('market-create', t('Nabídnout techniku', 'Offer a technique'), 'primary');
  bindBack(nav);
  if (shelf === 'browse') bindWaterPicker('market-water', waterDirectory, water);
  if (by('market-water')) by('market-water').onchange = e => {
    view.route.water = e.target.value || null; view.route.cursor = null; nav.show();
  };
  if (data.balance == null) claim(view, nav);
  for (const key of Object.keys(shelves())) {
    by('shelf-' + key).setAttribute('aria-pressed', String(key === shelf));
    bind('shelf-' + key, () => { view.route.shelf = key; view.route.cursor = null; nav.show(); });
  }
  data.items.forEach((item, i) => bind('offer-' + i, () => nav.open('marketDetail', { id: item.id })));
  if (data.next) bind('market-more', () => nav.open('marketShelf', { shelf, water, cursor: data.next }));
  bind('market-create', () => nav.open('marketEditor', { water }));
}

export async function marketDetail({ view, nav, waterDirectory }) {
  const { id } = view.route;
  let item, directory;
  try { [item,directory] = await Promise.all([rpc('market_detail', { offer_id: id }),fishDirectory()]); }
  catch (err) { return loadError(view, nav, err); }
  if (!view.active()) return;
  const available = !item.withdrawn && (item.limit == null || item.limit > item.sold);
  screen.innerHTML = heading(item.title) + '<article class="surface"><h2>' + t('Rybářská technika', 'Fishing technique') +
    '</h2>' + offerFacts(item, waterDirectory, directory) + '</article>' +
    (item.mine || item.purchased ? '<section class="surface"><h2>' +
      (item.mine ? t('Obsah tvého tipu', 'Your technique') : t('Zakoupená technika', 'Purchased technique')) +
      '</h2><p class="discussion-body" id="market-technique">' + esc(item.technique) + '</p></section>' :
      '<p>' + t('Odemkneš textový postup autora.', 'Unlock the author’s written technique.') + '</p>') +
    purchaseRating(item) +
    '<div class="actions">' + (item.mine && !item.withdrawn ?
      button('market-edit', editLabel(), 'secondary') + button('market-withdraw', t('Stáhnout nabídku', 'Withdraw offer'), 'danger') :
      !item.mine && !item.purchased && available ? (item.balance == null ? button('market-activate', activate(), 'secondary') :
        '<p>' + t('Zůstatek', 'Balance') + ' · ' + credits(item.balance) + '</p>' +
        (item.balance >= item.price ? button('market-buy', t('Odemknout tip', 'Unlock tip'), 'primary') :
          '<p>' + errorText(402) + '</p>')) : '') + '</div>';
  bindBack(nav);
  bindPurchaseRating(view, nav, id);
  if (by('market-activate')) claim(view, nav);
  if (by('market-edit')) bind('market-edit', () => nav.open('marketEditor', { id }));
  if (by('market-withdraw')) bind('market-withdraw', async () => {
    if (!await confirmAction({ title: t('Stáhnout nabídku?', 'Withdraw offer?'),
      message: t('Dosavadním kupujícím zůstane zakoupený postup.', 'Existing buyers keep their purchased version.'),
      accept: t('Stáhnout', 'Withdraw'), destructive: true })) return;
    await submitChange(view, () => rpc('market_withdraw', { offer_id: id }), () => nav.show(), err => toast(errorText(err.status)));
  });
  if (by('market-buy')) bind('market-buy', async () => {
    if (!await confirmAction({ title: t('Potvrdit nákup tipu?', 'Confirm tip purchase?'),
      message: item.title + ' · ' + credits(item.price), accept: t('Koupit za ', 'Buy for ') + credits(item.price) })) return;
    await submitChange(view, () => rpc('market_buy', { offer_id: id, expected_revision: item.revision, expected_price: item.price }),
      () => nav.show(), err => {
        toast(errorText(err.status));
        if ([402, 404, 409].includes(err.status)) nav.show();
      });
  });
}

/** An author explicitly writes the unlocked text. No notes, photos or coordinates are copied from a trip. */
export async function marketEditor({ view, nav, waterDirectory }) {
  const route = view.route;
  let old, directory;
  try {
    directory = await fishDirectory();
    if (route.id) old = await rpc('market_detail', { offer_id: route.id });
  } catch (err) { return loadError(view, nav, err); }
  if (!view.active()) return;
  if (route.id && (!old.mine || old.withdrawn)) return loadError(view, nav, { status: 404 });
  route.requestId ??= newJournalId();
  const currentDay = today('Europe/Prague');
  screen.innerHTML = heading(old ? editLabel() : t('Nabídnout techniku', 'Offer a technique')) +
    '<form id="market-form" class="entry-form"><fieldset class="surface"><legend>' + t('Veřejný náhled', 'Public preview') + '</legend>' +
    textInput('offer-title', t('Název techniky', 'Technique title'), old?.title, 'required maxlength="80"') +
    selectField('offer-country', t('Země v katalogu ryb', 'Fish catalogue country'), countryOptions(directory), preferredCountry(directory)) +
    textInput('species-filter',t('Hledat v katalogu ryb','Search the fish catalogue'),'','type="search"') +
    field('offer-species',t('Cílová ryba','Target fish'),'<select id="offer-species" required></select>') +
    textInput('offer-day', t('Datum zkušenosti', 'Date fished'), old?.day ?? route.day ?? currentDay,
      'required type="date" min="1900-01-01" max="' + currentDay + '"') +
    waterPicker('offer-water', t('Revír v náhledu', 'Water shown in preview'), t('Neuvádět', 'Omit')) +
    selectField('offer-access', t('Způsob lovu', 'Where to fish'), Object.entries(access()), old?.access ?? 'shore') +
    textInput('offer-price', t('Cena v testovacích kreditech', 'Price in test credits'), old?.price ?? 10, 'required type="number" min="1" max="100"') +
    textInput('offer-limit', t('Celkový limit prodejů (volitelný)', 'Total sales limit (optional)'), old?.limit ?? '',
      'type="number" min="' + Math.max(1, old?.sold || 0) + '" max="10000"') +
    '</fieldset><fieldset class="surface"><legend>' + t('Jen pro kupující', 'Only for buyers') + '</legend>' +
    field('offer-technique', t('Textový postup', 'Written technique'),
      '<textarea required minlength="10" maxlength="2000" rows="5" id="offer-technique">' + esc(old?.technique) + '</textarea>') +
    '</fieldset><button id="market-preview" class="primary">' + t('Zkontrolovat nabídku', 'Review offer') + '</button></form>';
  bindBack(nav);
  bindWaterPicker('offer-water', waterDirectory, old?.water ?? route.water);
  const picker = by('offer-species');
  const country = by('offer-country');
  const search = by('species-filter');
  function choices(selected) {
    const items = matchingSpecies(directory, country.value, search.value);
    picker.replaceChildren(new Option(t('Vyber druh z katalogu','Choose a catalogue species'),''));
    // An author can keep a historical species while editing other offer details.
    if (selected && selected === old?.species && !search.value.trim() && !items.some(fish => fish.latin === selected)) {
      const fish = directory.names.get(selected);
      picker.add(new Option(t('Uložený druh', 'Saved species') + ' · ' + (fish ? fishOption(fish) : selected), selected));
    }
    for (const fish of items) picker.add(new Option(fishOption(fish), fish.latin));
    picker.value = selected;
    if (picker.selectedIndex < 0) picker.selectedIndex = 0;
  }
  choices(old?.species || '');
  search.oninput = () => choices(picker.value);
  country.onchange = () => {
    localStorage.setItem('fish.country', country.value);
    choices(picker.value);
  };
  const form = by('market-form');
  trackEdits(form, view);
  form.onsubmit = event => {
    event.preventDefault();
    const val = id => by('offer-' + id).value.trim();
    const draft = { title: val('title'), species: val('species'), day: val('day'), access: val('access'), water: val('water') || null,
      price: Number(val('price')), limit: val('limit') ? Number(val('limit')) : null, technique: val('technique') };
    if (!draft.title || !draft.species || draft.technique.length < 10) return toast(errorText(422));
    review(draft);
  };
  async function review(draft) {
    const message = [draft.title, draft.species, displayDay(draft.day), access()[draft.access], waterName(waterDirectory, draft.water),
      credits(draft.price), draft.limit == null ? t('Bez limitu', 'Unlimited') : t('Limit prodejů: ', 'Sales limit: ') + draft.limit]
      .filter(Boolean).join(' · ');
    if (!await confirmAction({ title: t('Zveřejnit tento náhled?', 'Publish this preview?'), message,
      accept: t('Zveřejnit nabídku', 'Publish offer') })) return;
    await submitChange(view, () => rpc('market_publish', { offer_id: old?.id ?? route.requestId, expected_revision: old?.revision ?? 0, draft }),
      () => { view.dirty = false; toast(t('Nabídka uložena.', 'Offer saved.')); nav.back(); },
      err => {
        toast(errorText(err.status));
        if (err.status === 409 && !by('market-refresh-editor')) {
          form.insertAdjacentHTML('afterend', button('market-refresh-editor', t('Načíst aktuální nabídku', 'Load current offer'), 'secondary'));
          bind('market-refresh-editor', () => nav.leave(() => nav.show()));
        }
      });
  }
}
