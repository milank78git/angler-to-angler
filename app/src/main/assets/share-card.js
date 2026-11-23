import { Journal } from './journal.js';
import { pixelJpeg } from './photo.js';
import { back, bindBack, button, by, cs, displayDay, esc, loc, screen, t, toast } from './ui.js';

/** A card is an allowlist of display values. Private journal records never cross the Android bridge. */
function cardFields(trip, entry) {
  const length = entry.lengthMm
    ? new Intl.NumberFormat(cs ? 'cs-CZ' : 'en-GB').format(entry.lengthMm / 10) + ' cm'
    : '';
  return [
    ['length', t('Délka', 'Length'), length],
    ['day', t('Datum výpravy', 'Trip date'), trip.day && displayDay(trip.day)],
    ['water', t('Revír', 'Water'), trip.waterName],
    ['bait', t('Nástraha', 'Bait'), entry.bait],
    ['technique', t('Technika', 'Technique'), entry.technique],
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
  const [trip, entry] = await Promise.all([Journal.trip(tripId), Journal.catchById(catchId)]);
  if (!view.active()) return;
  if (!trip || !entry || entry.tripId !== tripId) {
    nav.back();
    return;
  }
  const species = pack.species[entry.speciesId];
  const title = species ? loc(species) : entry.speciesName || entry.speciesId;
  const fields = cardFields(trip, entry);
  const choices = fields.map(([key, label]) => [key, label]);
  if (entry.hasPhoto) choices.push(['photo', t('Fotografie', 'Photo')]);
  screen.innerHTML =
    back(t('Výprava', 'Trip')) +
    `
    <div class="page-intro"><h1>${t('Sdílet úlovek', 'Share catch')}</h1></div>
    <div class="columns">
      <section class="surface"><h2>${t('Co chceš sdílet?', 'What would you like to share?')}</h2>
        <p>${t('Na kartě je vždy druh ryby. Další údaje vyber níže.', 'Your card includes the species. Choose any other details below.')}</p>
        <div id="card-options">${choices.map(([key, label]) => `<label class="card-option"><input type="checkbox" id="share-${key}">${esc(label)}</label>`).join('')}</div>
        <p class="meta">${t('Souřadnice a poznámky zůstanou v deníku. Místo může být poznat z fotky nebo z vybraného textu.', 'Coordinates and journal notes stay private. The photo or selected text may reveal the location.')}</p>
      </section>
      <section class="surface"><h2>${t('Náhled pro příjemce', 'Recipient preview')}</h2>
        <p id="card-text" aria-live="polite"></p><img id="card-image" class="preview" hidden alt="${t('Sdílená fotografie úlovku', 'Catch photo for sharing')}">
        <p id="card-status" role="status" hidden></p>
        <div class="actions">${button('card-send', t('Vybrat příjemce', 'Choose recipient'), 'primary')}</div>
      </section>
    </div>`;
  bindBack(nav);
  const send = by('card-send'),
    image = by('card-image'),
    status = by('card-status');
  let photoTask,
    payload,
    revision = 0;

  /** Keep the last ready preview and the outgoing payload identical, including during rapid changes. */
  async function preview() {
    const current = ++revision;
    payload = null;
    send.disabled = true;
    const lines = [
      title,
      ...fields
        .filter(([key]) => by('share-' + key).checked)
        .map(([, label, value]) => label + ' · ' + value),
    ];
    const text = lines.join('\n');
    by('card-text').textContent = text;
    image.hidden = true;
    image.removeAttribute('src');
    status.hidden = true;
    let jpeg = '';
    if (by('share-photo')?.checked) {
      status.hidden = false;
      status.textContent = t('Připravuji fotografii…', 'Preparing photo…');
      try {
        photoTask ??= photoCopy(catchId);
        const dataUrl = await photoTask;
        if (!view.active() || current !== revision) return;
        image.src = dataUrl;
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
  }
  by('card-options').onchange = preview;
  send.onclick = () => {
    if (!payload || !view.active()) return;
    if (!window.Device?.shareCatch || !window.Device.shareCatch(payload.text, payload.jpeg))
      toast(t('Sdílení se nepodařilo otevřít. Zkus to znovu.', 'Could not open sharing. Please retry.'));
  };
  await preview();
}
