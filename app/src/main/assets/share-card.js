import { languageTag } from './i18n.js';
import { bindGroupTip, groupTipControls } from './group-tip.js';
import { Journal } from './journal.js';
import { pixelJpeg } from './photo.js';
import { back, bindBack, button, by, displayDay, esc, field, loc, screen, t, toast } from './ui.js';

/** A card is an allowlist of display values. Private journal records never cross the Android bridge. */
function cardFields(trip, entry) {
  const length = entry?.lengthMm
    ? new Intl.NumberFormat(languageTag).format(entry.lengthMm / 10) + ' cm'
    : '';
  return [
    ['length', t('Délka', 'Length'), length],
    ['day', t('Datum výpravy', 'Trip date'), trip.day && displayDay(trip.day)],
    ['water', t('Revír', 'Water'), trip.waterName],
    ['bait', t('Nástraha', 'Bait'), entry?.bait],
    ['technique', t('Technika', 'Technique'), entry?.technique],
  ].filter(([, , value]) => value);
}

async function photoCopy(id) {
  const stored = await Journal.photo(id);
  if (!stored) throw Error('Photo unavailable');
  const jpeg = await pixelJpeg(stored, 1280);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(jpeg);
  });
}

export async function shareCard({ view, nav, pack }) {
  const { tripId, catchId } = view.route;
  const [trip, entry] = await Promise.all([
    Journal.trip(tripId),
    catchId ? Journal.catchById(catchId) : null,
  ]);
  if (!view.active()) return;
  if (!trip || (catchId && (!entry || entry.tripId !== tripId))) {
    nav.back();
    return;
  }
  const species = pack.species[entry?.speciesId];
  const speciesName = species ? loc(species) : entry?.speciesName || entry?.speciesId;
  const heading = entry ? t('Sdílet úlovek', 'Share catch') : t('Sdílet zkušenost', 'Share a trip tip');
  const fields = cardFields(trip, entry);
  const choices = fields.map(([key, label]) => [key, label]);
  if (entry?.hasPhoto) choices.push(['photo', t('Fotografie', 'Photo')]);
  screen.innerHTML =
    back(t('Výprava', 'Trip')) +
    `
    <div class="page-intro"><h1>${heading}</h1></div>
    <div class="columns">
      <section class="surface"><h2>${t('Co chceš sdílet?', 'What would you like to share?')}</h2>
        ${field('share-tip-text', entry ? t('Tip pro ostatní (nepovinné)', 'Tip for others (optional)') : t('Co bys poradil ostatním?', 'What would you tell other anglers?'), '<textarea id="share-tip-text" rows="3" maxlength="1600"></textarea>')}
        <p>${entry ? t('Na kartě je vždy druh ryby. Další údaje vyber níže.', 'Your card includes the species. Choose any other details below.') : t('K tipu můžeš přidat datum a revír.', 'You can add the date and water to your tip.')}</p>
        <div id="card-options">${choices.map(([key, label]) => `<label class="card-option"><input type="checkbox" id="share-${key}">${esc(label)}</label>`).join('')}</div>
        <p class="meta">${entry ? t('Souřadnice a poznámky zůstanou v deníku. Místo může být poznat z fotky nebo z vybraného textu.', 'Coordinates and journal notes stay private. The photo or selected text may reveal the location.') : t('Soukromé poznámky z deníku se do zprávy nekopírují.', 'Private journal notes are never copied into the message.')}</p>
      </section>
      <section class="surface"><h2>${t('Náhled pro příjemce', 'Recipient preview')}</h2>
        <p id="card-text" aria-live="polite"></p><img id="card-image" class="preview" hidden alt="${t('Sdílená fotografie úlovku', 'Catch photo for sharing')}">
        <p id="card-status" role="status" hidden></p>
        <div class="actions">${button('card-send', entry ? t('Vybrat příjemce', 'Choose recipient') : t('Sdílet přes jinou aplikaci', 'Share via another app'), 'primary')}</div>
        ${entry ? '' : groupTipControls()}
      </section>
    </div>`;
  bindBack(nav);
  const send = by('card-send'),
    image = by('card-image'),
    status = by('card-status');
  let photoTask,
    payload,
    revision = 0;

  const syncGroup = entry ? null : bindGroupTip(view, nav, tripId, () => payload?.text);

  /** Keep the last ready preview and the outgoing payload identical, including during rapid changes. */
  async function preview() {
    const current = ++revision;
    payload = null;
    syncGroup?.();
    send.disabled = true;
    const tip = by('share-tip-text').value.trim();
    const lines = [
      speciesName,
      tip,
      ...fields
        .filter(([key]) => by('share-' + key).checked)
        .map(([, label, value]) => label + ' · ' + value),
    ];
    const text = lines.filter(Boolean).join('\n');
    by('card-text').textContent = text;
    status.hidden = true;
    const includePhoto = by('share-photo')?.checked;
    if (!includePhoto) {
      image.hidden = true;
      image.removeAttribute('src');
    }
    if (!entry && !tip) return;
    if (text.length > 4096) {
      status.hidden = false;
      status.textContent = t('Zkrať text nebo odeber některý údaj.', 'Shorten the text or remove a detail.');
      return;
    }
    let jpeg = '';
    if (includePhoto) {
      status.hidden = false;
      status.textContent = t('Připravuji fotografii…', 'Preparing photo…');
      try {
        photoTask ??= photoCopy(catchId);
        const dataUrl = await photoTask;
        if (!view.active() || current !== revision) return;
        if (image.src !== dataUrl) image.src = dataUrl;
        image.hidden = false;
        jpeg = dataUrl.slice(dataUrl.indexOf(',') + 1);
        status.hidden = true;
      } catch {
        if (!view.active() || current !== revision) return;
        photoTask = undefined;
        status.textContent = t(
          'Fotku se nepodařilo připravit. Zruš její výběr nebo ji vyber znovu.',
          'Could not prepare the photo. Deselect it or select it again to retry.',
        );
        return;
      }
    }
    payload = { text, jpeg };
    send.disabled = false;
    syncGroup?.();
  }
  by('card-options').onchange = preview;
  by('share-tip-text').oninput = () => {
    view.dirty = Boolean(by('share-tip-text').value.trim());
    preview();
  };
  send.onclick = () => {
    if (!payload || !view.active()) return;
    if (window.Device?.shareCatch?.(payload.text, payload.jpeg)) {
      view.dirty = false;
    } else toast(t('Sdílení se nepodařilo otevřít. Zkus to znovu.', 'Could not open sharing. Please retry.'));
  };
  await preview();
}
