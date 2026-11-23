import { screen, by, t, esc, button, back, bindBack, bind, toast } from './ui.js';
import { today } from './domain.js';
import { Journal } from './journal.js';
import { showError } from './profiles.js';
import { rpc, failure, photoPayload } from './profile-api.js';

const states = {
  pending: t('Čeká na kontrolu', 'Awaiting review'),
  measured: t('Ověřeno podle míry', 'Verified from ruler'),
  estimated: t('Ověřeno odhadem', 'Verified by estimate'),
  unverified: t('Neověřeno', 'Unverified'),
};
const labels = {
  submit: t('Ověření tohoto úlovku', 'Verify this catch'),
  withdraw: t('Odstranit ověření', 'Remove verification'),
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
    label.textContent = states.unverified;
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
      if (view.active()) nav.open('evidence');
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
    t('Ověření úlovků', 'Catch verification') +
    '</h1>' +
    '<p>' +
    t(
      'Do profilu se počítají snímky, na kterých kontrolor rozezná rybu a přečte míru nebo odhadne délku podle známého měřítka.',
      'Your profile counts photos where a reviewer sees the fish and can read a ruler or estimate length against a known-size reference.',
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
          '</p><strong>' +
          esc(states[item.outcome]) +
          (item.mm ? ' · ' + esc(item.mm / 10) + ' cm' : '') +
          '</strong><div><button class="secondary" data-remove="' +
          esc(item.id) +
          '">' +
          labels.withdraw +
          '</button></div></article>',
      )
      .join('') ||
      '<p>' +
        t(
          'Žádné odeslané úlovky. Pro první ověření vyfoť úlovek při zápisu do deníku.',
          'No submissions. To verify a catch, take its photo when adding it to the journal.',
        ) +
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
              'Odstranit kontrolní záznam a jeho příspěvek do počtu ověření? Místní deník si úlovek ponechá.',
              'Remove this review record and its contribution to the verified count? The catch stays in the local journal.',
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
        states.measured +
        '</option><option value="estimated">' +
        states.estimated +
        '</option><option value="unverified">' +
        states.unverified +
        '</option></select>' +
        '<small>' +
        t(
          'Zkontroluj, že poloha odpovídá uvedené vodě. Míra musí být čitelná. Odhad vyžaduje celou rybu a rozpoznatelný předmět známé velikosti ve stejné rovině. Jinak zvol Neověřeno.',
          'Check that the location matches the water. The ruler must be legible. An estimate requires the whole fish and a recognisable, known-size reference in the same plane. Otherwise select Unverified.',
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
