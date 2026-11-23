import { screen, by, t, esc, button, back, bindBack, bind, toast } from './ui.js';
import { today } from './domain.js';
import { Journal } from './journal.js';
import { showError } from './profiles.js';
import { rpc, failure, photoPayload } from './profile-api.js';

const outcomes = {
  pending: t('Čeká na kontrolu', 'Awaiting review'),
  measured: t('Délka odečtená z míry', 'Length read from ruler'),
  estimated: t('Délka odhadnutá podle měřítka', 'Length estimated from a reference'),
  unverified: t('Nedostatečný podklad', 'Insufficient evidence'),
};
const labels = {
  submit: t('Doložení úlovku fotkou', 'Catch photo review'),
  withdraw: t('Odstranit záznam kontroly', 'Remove review record'),
};

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
    label.textContent = t('Bez kontroly snímku', 'Photo not reviewed');
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
      if (
        !confirm(
          t(
            'Předat kontrolorovi fotku, druh, čas, název vody a přibližnou polohu (na setiny stupně)? Po rozhodnutí se fotka a poloha z fronty odstraní.',
            'Send the photo, species, time, water name and approximate location (rounded to 0.01 degrees) to a reviewer? The review copy of the image and location is removed after a decision.',
          ),
        )
      )
        return;
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

function reviewResult({ outcome, mm }) {
  if (outcome !== 'measured' && outcome !== 'estimated') {
    return '<strong>' + esc(outcomes[outcome]) + '</strong>';
  }
  const cm = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 }).format(
    mm / 10,
  );
  return (
    '<strong>' +
    t('Doloženo fotkou', 'Photo documented') +
    '</strong><p>' +
    outcomes[outcome] +
    ' · ' +
    esc(cm) +
    ' cm</p>'
  );
}

function localTime(value) {
  return new Date(value).toLocaleString(document.documentElement.lang);
}

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
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    (view.route.onlyId
      ? t('Kontrola fotky úlovku', 'Catch photo review')
      : t('Moje odeslané fotky', 'My submitted catch photos')) +
    '</h1>' +
    '<p>' +
    t(
      'V profilu přibude jeden úlovek, když kontrolor rozezná rybu a z fotky odečte nebo odhadne její délku. Poloha udává, kde byl telefon při focení.',
      'A catch counts once a reviewer can see the fish and read or estimate its length from the photo. The location shows where the phone was at capture.',
    ) +
    '</p>' +
    (page.reviewer ? button('review', t('Zkontrolovat snímky', 'Review submitted photos'), 'primary') : '') +
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
          ? t('K tomuto úlovku tu žádný snímek není.', 'There is no submission for this catch.')
          : t(
              'Žádné odeslané fotky. Fotku pořízenou u vody můžeš odeslat z výpravy v deníku.',
              'No submitted photos. You can send a photo taken at the water from the trip in your journal.',
            )) +
        '</p>') +
    '</div>' +
    (page.more ? button('more', t('Starší záznamy', 'Older records'), 'secondary') : '') +
    button('refresh-evidence', t('Obnovit', 'Refresh'), 'secondary');
  bindBack(nav);
  bind('refresh-evidence', () => nav.show());
  if (page.reviewer) bind('review', () => nav.open('review'));
  if (page.more)
    bind('more', () => {
      const last = page.items[page.items.length - 1];
      nav.open('evidence', { time: last.submitted, id: last.id });
    });
  screen.querySelectorAll('[data-remove]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !confirm(
            t(
              'Odstranit záznam kontroly? Úlovek zůstane v deníku. Pokud byl započítaný do profilu, počet se sníží o jeden.',
              'Remove this review record? The catch stays in your journal. If it counted towards your profile total, the total will decrease by one.',
            ),
          )
        )
          return;
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

export async function reviewScreen({ view, nav }) {
  let item;
  try {
    ({ item } = await rpc('evidence_review'));
  } catch (error) {
    return showError(view, nav, error);
  }
  if (!view.active()) return;
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    '<h1>' +
    t('Kontrola snímků', 'Photo review') +
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
        t('Snímek úlovku', 'Catch photograph') +
        '" src="data:image/jpeg;base64,' +
        esc(item.photo) +
        '"></article>' +
        '<form id="decision" class="entry-form"><section class="surface"><label for="outcome">' +
        t('Výsledek kontroly', 'Review outcome') +
        '</label><select id="outcome" required><option value="">—</option><option value="measured">' +
        outcomes.measured +
        '</option><option value="estimated">' +
        outcomes.estimated +
        '</option><option value="unverified">' +
        outcomes.unverified +
        '</option></select>' +
        '<small>' +
        t(
          'Porovnej místo focení s uvedenou vodou. Délku odečti z čitelné míry, nebo ji odhadni podle předmětu známé velikosti ve stejné rovině jako celá ryba. Pokud poloha nesedí, měřítko chybí nebo jde o přefocený snímek, zvol Nedostatečný podklad.',
          'Compare the capture location with the reported water. Read the length from a legible ruler, or estimate it using a known-size object in the same plane as the whole fish. If the location is inconsistent, the scale is unclear or the image shows another photograph, select Insufficient evidence.',
        ) +
        '</small>' +
        '<label for="review-length">' +
        t('Délka podle snímku (cm)', 'Length from photo (cm)') +
        '</label><input id="review-length" type="number" min="0.1" max="2000" step="0.1" required></section>' +
        '<button class="primary">' +
        t('Uložit rozhodnutí', 'Save decision') +
        '</button></form>'
      : '<p>' +
        t('Žádné cizí snímky nečekají na kontrolu.', 'No other anglers’ photos are awaiting review.') +
        '</p>');
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
