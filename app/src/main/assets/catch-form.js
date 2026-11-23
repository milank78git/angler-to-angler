import { pixelJpeg } from './photo.js';
import { Journal, newJournalId } from './journal.js';
import { bindCatchPosition } from './catch-position.js';
import * as Domain from './domain.js';
import {
  screen,
  t,
  loc,
  by,
  button,
  icon,
  back,
  bindBack,
  toast,
  textInput,
  selectField,
  trackEdits,
  writeEntry,
} from './ui.js';
function bindPhotoPreview() {
  let preview, file, capture;
  function choose(input, camera) {
    if (!input.files[0]) return;
    file = input.files[0];
    capture = camera ? JSON.parse(window.Device?.cameraFix?.() || 'null') : null;
    by(camera ? 'photo' : 'camera-photo').value = '';
    by('capture-state').textContent = capture
      ? t(
          'Snímek má polohu pro ověření. Po uložení ho můžeš odeslat z detailu výpravy.',
          'This photo has a location fix. After saving, you can submit it from the trip.',
        )
      : t(
          'Fotografie zůstane v deníku jako neověřená.',
          'This photo will stay in the journal as unverified.',
        );
    if (preview) URL.revokeObjectURL(preview);
    preview = file ? URL.createObjectURL(file) : null;
    const img = by('photo-preview');
    img.hidden = !file;
    if (file) img.src = preview;
    else img.removeAttribute('src');
    by('photo-label').textContent = file
      ? t('Změnit fotografii', 'Change photo')
      : t('Přidat fotografii', 'Add photo');
  }
  by('photo').onchange = (e) => choose(e.target, false);
  by('camera-photo').onchange = (e) => choose(e.target, true);
  return {
    file: () => file || by('photo').files[0],
    capture: () => capture,
    dispose() {
      if (preview) URL.revokeObjectURL(preview);
    },
  };
}

/** Capture the draft once and commit the catch and its photograph together. */
export function catchForm({ view, nav, pack }) {
  const { id } = view.route,
    catchId = newJournalId(),
    created = Date.now();
  screen.innerHTML = catchFields(pack);
  const positionInput = bindCatchPosition(view);
  const photoInput = bindPhotoPreview();
  by('camera-photo').onclick = (event) => {
    if (positionInput.waiting()) {
      event.preventDefault();
      toast(t('Vyčkej na polohu nebo zruš její hledání.', 'Wait for the location or cancel the request.'));
    }
  };
  view.dispose = () => {
    positionInput.dispose();
    photoInput.dispose();
  };
  bindBack(nav);
  trackEdits(by('form'), view);
  by('fish-name').required = true;
  by('fish').onchange = () => {
    by('custom-fish').hidden = !!by('fish').value;
    by('fish-name').required = !by('fish').value;
  };
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving) return;
    if (positionInput.waiting()) {
      toast(t('Vyčkej na polohu nebo zruš její hledání.', 'Wait for the location or cancel the request.'));
      return;
    }
    by('form-error').hidden = true;
    for (const invalid of by('form').querySelectorAll('[aria-invalid]')) {
      invalid.removeAttribute('aria-invalid');
      invalid.removeAttribute('aria-describedby');
    }
    const speciesId = by('fish').value,
      speciesName = by('fish-name').value.trim();
    if (!speciesId && !speciesName) {
      toast(t('Zadej druh ryby.', 'Enter a fish species.'));
      return;
    }
    let lengthMm, position;
    try {
      lengthMm = Domain.lengthMm(by('length').value);
      position = positionInput.read();
    } catch (err) {
      if (err.message !== 'length') by('position-fields').open = true;
      const invalid = by(err.message);
      invalid.setAttribute('aria-invalid', 'true');
      invalid.setAttribute('aria-describedby', 'form-error');
      by('form-error').hidden = false;
      by('form-error').textContent =
        err.message === 'length'
          ? t('Uveď kladnou délku v centimetrech.', 'Enter a positive length in centimetres.')
          : t(
              'Zkontroluj obě souřadnice (šířka ±90°, délka ±180°).',
              'Check both coordinates (latitude ±90°, longitude ±180°).',
            );
      invalid.focus();
      return;
    }
    const file = photoInput.file();
    const record = {
      id: catchId,
      tripId: id,
      created,
      speciesId: speciesId || null,
      speciesName: speciesId ? loc(pack.species[speciesId]) : speciesName,
      lengthMm,
      position,
      capture: photoInput.capture() || null,
      bait: by('bait').value.trim(),
      technique: by('technique').value.trim(),
    };
    await writeEntry(
      view,
      nav,
      id,
      async () => {
        const photo = await pixelJpeg(file, 1920);
        await Journal.saveCatch(record, photo);
      },
      (error) =>
        toast(
          error.message === 'photo'
            ? t(
                'Fotografii nelze přečíst. Vyber snímek do 30 MB.',
                'Cannot read the photo. Choose an image under 30 MB.',
              )
            : t(
                'Úlovek se neuložil. Zápis zůstal otevřený pro další pokus.',
                'Saving failed. Your entry is still here to retry.',
              ),
        ),
    );
  };
}
function catchFields(pack) {
  const fish = [
    ['', t('Vlastní druh', 'Other species')],
    ...Object.entries(pack.species).map(([id, species]) => [id, loc(species)]),
  ];
  const kinds = [
    ['stand', t('Stanoviště rybáře', 'Angler position')],
    ['strike', t('Místo záběru', 'Strike location')],
  ];
  return (
    back(t('Výprava', 'Trip')) +
    `<div class="page-intro"><div class="title-mark">${icon('fish')}</div><h1>${t('Nový úlovek', 'New catch')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${selectField('fish', t('Druh ryby', 'Fish species'), fish, '')}
    <div id="custom-fish">${textInput('fish-name', t('Název druhu', 'Species name'), '', 'maxlength="100"')}</div>
    ${textInput('length', t('Změřená délka (cm)', 'Measured length (cm)'), '', 'inputmode="decimal" placeholder="64,5"')}
    <div class="photo-field"><input type="file" id="camera-photo" accept="image/*" capture="environment"><label for="camera-photo">${icon('camera')}${t('Vyfotit úlovek pro ověření', 'Photograph catch for verification')}</label>
    <small>${t('Vyfoť celou rybu s mírou nebo předmětem známé velikosti. Po focení vyčkej na polohu telefonu. Odeslání ke kontrole je dobrovolné.', 'Photograph the whole fish with a ruler or a known-size reference. Wait for a location fix after taking the picture. Sending it for review is optional.')}</small>
    <input type="file" id="photo" accept="image/*"><label for="photo">${icon('camera')}<span id="photo-label">${t('Přidat fotografii', 'Add photo')}</span></label><small id="capture-state" role="status"></small><img id="photo-preview" class="preview" hidden alt=""></div></section>
  <details class="fold"><summary>${icon('fish-symbol')}${t('Nástraha a technika', 'Bait and technique')}</summary><div class="fold-body">${textInput('bait', t('Na co zabral', 'Bait or lure'), '', 'maxlength="300"')}${textInput('technique', t('Technika lovu', 'Fishing technique'), '', 'maxlength="500"')}</div></details>
  <details id="position-fields" class="fold"><summary>${icon('lock-keyhole')}${t('Soukromá poloha', 'Private location')}</summary><div class="fold-body">${selectField('kind', t('Co bod označuje', 'Point represents'), kinds, 'stand')}
  <div class="pair"><div>${textInput('lat', t('Šířka', 'Latitude'), '', 'placeholder="49.8783"')}</div><div>${textInput('lon', t('Délka', 'Longitude'), '', 'placeholder="14.4282"')}</div></div>
  <div class="actions">${button('gps', t('Použít současnou polohu', 'Use current location'), 'secondary', 'locate-fixed')}</div><small>${t('U starší fotky zadej místo ručně nebo ho nech prázdné.', 'For older photos, enter the location manually or leave it empty.')}</small></div></details>
  <p class="field-error" id="form-error" role="alert" hidden></p><div class="savebar"><button class="primary">${icon('check')}${t('Uložit úlovek', 'Save catch')}</button></div></form>`
  );
}
