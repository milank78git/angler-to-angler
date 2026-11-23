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
/** Decode and re-encode into pixels only, dropping source EXIF and location metadata. */
async function journalPhoto(file) {
  if (!file) return null;
  if (file.size > 30 * 1024 * 1024) throw Error('photo');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error('photo'));
      image.src = url;
    });
    const ratio = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error('photo'))), 'image/jpeg', 0.84),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
function bindPhotoPreview() {
  let preview;
  by('photo').onchange = () => {
    if (preview) URL.revokeObjectURL(preview);
    const file = by('photo').files[0];
    preview = file ? URL.createObjectURL(file) : null;
    const img = by('photo-preview');
    img.hidden = !file;
    if (file) img.src = preview;
    else img.removeAttribute('src');
    by('photo-label').textContent = file
      ? t('Změnit fotografii', 'Change photo')
      : t('Přidat fotografii', 'Add photo');
  };
  return () => {
    if (preview) URL.revokeObjectURL(preview);
  };
}

/** Capture the draft once and commit the catch and its photograph together. */
export function catchForm({ view, nav, pack }) {
  const { id } = view.route,
    catchId = newJournalId(),
    created = Date.now();
  screen.innerHTML = catchFields(pack);
  const positionInput = bindCatchPosition(view);
  const releasePhoto = bindPhotoPreview();
  view.dispose = () => {
    positionInput.dispose();
    releasePhoto();
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
    const file = by('photo').files[0];
    const record = {
      id: catchId,
      tripId: id,
      created,
      speciesId: speciesId || null,
      speciesName: speciesId ? loc(pack.species[speciesId]) : speciesName,
      lengthMm,
      position,
      bait: by('bait').value.trim(),
      technique: by('technique').value.trim(),
    };
    await writeEntry(
      view,
      nav,
      id,
      async () => {
        const photo = await journalPhoto(file);
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
    <div class="photo-field"><input type="file" id="photo" accept="image/*"><label for="photo">${icon('camera')}<span id="photo-label">${t('Přidat fotografii', 'Add photo')}</span></label><img id="photo-preview" class="preview" hidden alt=""></div></section>
  <details class="fold"><summary>${icon('fish-symbol')}${t('Nástraha a technika', 'Bait and technique')}</summary><div class="fold-body">${textInput('bait', t('Na co zabral', 'Bait or lure'), '', 'maxlength="300"')}${textInput('technique', t('Technika lovu', 'Fishing technique'), '', 'maxlength="500"')}</div></details>
  <details id="position-fields" class="fold"><summary>${icon('lock-keyhole')}${t('Soukromá poloha', 'Private location')}</summary><div class="fold-body">${selectField('kind', t('Co bod označuje', 'Point represents'), kinds, 'stand')}
  <div class="pair"><div>${textInput('lat', t('Šířka', 'Latitude'), '', 'placeholder="49.8783"')}</div><div>${textInput('lon', t('Délka', 'Longitude'), '', 'placeholder="14.4282"')}</div></div>
  <div class="actions">${button('gps', t('Použít současnou polohu', 'Use current location'), 'secondary', 'locate-fixed')}</div><small>${t('U starší fotky zadej místo ručně nebo ho nech prázdné.', 'For older photos, enter the location manually or leave it empty.')}</small></div></details>
  <p class="field-error" id="form-error" role="alert" hidden></p><div class="savebar"><button class="primary">${icon('check')}${t('Uložit úlovek', 'Save catch')}</button></div></form>`
  );
}
