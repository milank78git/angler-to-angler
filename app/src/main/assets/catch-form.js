import { Journal, newJournalId } from './journal.js';
import * as Domain from './domain.js';
import {
  screen,
  t,
  loc,
  by,
  button,
  icon,
  bind,
  back,
  bindBack,
  toast,
  field,
  textInput,
  options,
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
let nextRequest = 0;
export function catchForm({ view, nav, pack }) {
  const { id } = view.route,
    catchId = newJournalId(),
    created = Date.now();
  let currentFix = null,
    pending = 0,
    preview;
  screen.innerHTML = catchFields(pack);

  function cancelPosition() {
    if (pending && window.Device) Device.cancelLocation(pending);
    pending = 0;
  }
  function positionResult(event) {
    if (!pending || event.detail.id !== pending) return;
    pending = 0;
    const fix = event.detail.fix;
    by('gps').disabled = false;
    by('gps').textContent = t('Použít současnou polohu', 'Use current location');
    if (!fix || view.saving) return;
    currentFix = fix;
    by('lat').value = fix.lat.toFixed(6);
    by('lon').value = fix.lon.toFixed(6);
    view.dirty = true;
  }
  window.addEventListener('angler-position', positionResult);
  view.dispose = () => {
    window.removeEventListener('angler-position', positionResult);
    cancelPosition();
    if (preview) URL.revokeObjectURL(preview);
  };
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
  bindBack(nav);
  trackEdits(by('form'), view);
  by('fish-name').required = true;
  by('fish').onchange = () => {
    by('custom-fish').hidden = !!by('fish').value;
    by('fish-name').required = !by('fish').value;
  };
  const clearFix = () => {
    currentFix = null;
    cancelPosition();
    by('gps').disabled = false;
    by('gps').textContent = t('Použít současnou polohu', 'Use current location');
  };
  by('lat').oninput = clearFix;
  by('lon').oninput = clearFix;
  bind('gps', () => {
    if (!window.Device) {
      toast(t('GPS je dostupná na Androidu.', 'GPS is available on Android.'));
      return;
    }
    if (pending) {
      clearFix();
      return;
    }
    pending = ++nextRequest;
    by('gps').textContent = t('Zrušit hledání polohy', 'Cancel location request');
    Device.location(pending);
  });
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving) return;
    if (pending) {
      toast(t('Vyčkej na polohu nebo zruš její hledání.', 'Wait for the location or cancel the request.'));
      return;
    }
    by('form-error').hidden = true;
    for (const key of ['length', 'lat', 'lon']) by(key).removeAttribute('aria-invalid');
    const speciesId = by('fish').value,
      speciesName = by('fish-name').value.trim();
    if (!speciesId && !speciesName) {
      toast(t('Zadej druh ryby.', 'Enter a fish species.'));
      return;
    }
    let lengthMm, point;
    try {
      lengthMm = Domain.lengthMm(by('length').value);
      point = Domain.point(by('lat').value, by('lon').value);
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
    const position = point
      ? {
          ...point,
          source: currentFix ? 'device' : 'manual',
          accuracy: currentFix?.accuracy ?? null,
          time: currentFix?.time ?? Date.now(),
          kind: by('kind').value,
        }
      : null;
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
  return (
    back(t('Výprava', 'Trip')) +
    `<div class="page-intro"><div class="title-mark">${icon('fish')}</div><h1>${t('Nový úlovek', 'New catch')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${field('fish', t('Druh ryby', 'Fish species'), '<select id="fish">' + options([['', t('Vlastní druh', 'Other species')], ...Object.entries(pack.species).map(([k, v]) => [k, loc(v)])], '') + '</select>')}
    <div id="custom-fish">${textInput('fish-name', t('Název druhu', 'Species name'), '', 'maxlength="100"')}</div>
    ${textInput('length', t('Změřená délka (cm)', 'Measured length (cm)'), '', 'inputmode="decimal" placeholder="64,5"')}
    <div class="photo-field"><input type="file" id="photo" accept="image/*"><label for="photo">${icon('camera')}<span id="photo-label">${t('Přidat fotografii', 'Add photo')}</span></label><img id="photo-preview" class="preview" hidden alt=""></div></section>
  <details class="fold"><summary>${icon('fish-symbol')}${t('Nástraha a technika', 'Bait and technique')}</summary><div class="fold-body">${textInput('bait', t('Na co zabral', 'Bait or lure'), '', 'maxlength="300"')}${textInput('technique', t('Technika lovu', 'Fishing technique'), '', 'maxlength="500"')}</div></details>
  <details id="position-fields" class="fold"><summary>${icon('lock-keyhole')}${t('Soukromá poloha', 'Private location')}</summary><div class="fold-body">${field(
    'kind',
    t('Co bod označuje', 'Point represents'),
    '<select id="kind">' +
      options(
        [
          ['stand', t('Stanoviště rybáře', 'Angler position')],
          ['strike', t('Místo záběru', 'Strike location')],
        ],
        'stand',
      ) +
      '</select>',
  )}
  <div class="pair"><div>${textInput('lat', t('Šířka', 'Latitude'), '', 'placeholder="49.8783"')}</div><div>${textInput('lon', t('Délka', 'Longitude'), '', 'placeholder="14.4282"')}</div></div>
  <div class="actions">${button('gps', t('Použít současnou polohu', 'Use current location'), 'secondary', 'locate-fixed')}</div><small>${t('U starší fotky zadej místo ručně nebo ho nech prázdné.', 'For older photos, enter the location manually or leave it empty.')}</small></div></details>
  <p class="field-error" id="form-error" role="alert" hidden></p><div class="savebar"><button class="primary">${icon('check')}${t('Uložit úlovek', 'Save catch')}</button></div></form>`
  );
}
