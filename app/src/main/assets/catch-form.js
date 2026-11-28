import { showsCloudPhotoPolicy } from './photo-retention.js';
import { replaceMarkup } from './markup.js';
import { languageTag } from './i18n.js';
import { fishDirectory } from './fish-catalogue.js';
import { bindCatchSpecies, catchSpeciesFields } from './catch-species.js';
import { tripWater } from './water-directory.js';
import { pixelJpeg } from './photo.js';
import { Journal, newJournalId } from './journal.js';
import { bindCatchPosition } from './catch-position.js';
import * as Domain from './domain.js';
import {
  screen,
  t,
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
const exampleNumber = new Intl.NumberFormat(languageTag, {
  maximumFractionDigits: 4,
  useGrouping: false,
  numberingSystem: 'latn',
});
/** Own temporary image URLs and keep a camera fix associated with the selected photo. */
function bindPhotoPreview(existing) {
  let preview, file, capture;
  if (existing) {
    preview = URL.createObjectURL(existing);
    by('photo-preview').src = preview;
    by('photo-preview').hidden = false;
    by('photo-label').textContent = t('catch_form.change_photo');
  }
  /** Replace the draft image and release any camera resource superseded by a gallery choice. */
  function choose(input, camera) {
    if (!input.files[0]) return;
    file = input.files[0];
    if (!camera) window.Device?.releaseCameraPhoto?.();
    capture = camera ? JSON.parse(window.Device?.cameraFix?.() || 'null') : null;
    by(camera ? 'photo' : 'camera-photo').value = '';
    by('capture-state').textContent = capture
      ? t('catch_form.this_photo_has_a_location_fix_after')
      : t('catch_form.this_photo_will_be_saved_in_your');
    if (preview) URL.revokeObjectURL(preview);
    preview = file ? URL.createObjectURL(file) : null;
    const img = by('photo-preview');
    img.hidden = !file;
    if (file) img.src = preview;
    else img.removeAttribute('src');
    by('photo-label').textContent = file ? t('catch_form.change_photo') : t('catch_form.add_photo');
  }
  by('photo').onchange = (e) => choose(e.target, false);
  by('camera-photo').onchange = (e) => choose(e.target, true);
  return {
    file: () => file || by('photo').files[0],
    capture: () => capture,
    /** Release any outstanding camera file and revoke the preview URL when the form is retired. */
    dispose() {
      window.Device?.releaseCameraPhoto?.();
      if (preview) URL.revokeObjectURL(preview);
    },
  };
}

/** Capture the draft once and commit the catch and its photograph together. */
/** @param {import('../../../../types/screens.js').ScreenContext} context */
export async function catchForm({ view, nav, pack, waterDirectory }) {
  const { id } = view.route,
    catchId = view.route.catchId || newJournalId(),
    created = Date.now();
  const [trip, directory, original] = await Promise.all([
    Journal.trip(id),
    fishDirectory().catch(() => null),
    view.route.catchId ? Journal.catchById(catchId) : null,
  ]);
  if (!view.active()) return;
  if (!trip || (view.route.catchId && original?.tripId !== id)) return nav.journalAfterWrite(null);
  const existingPhoto = original?.hasPhoto ? await Journal.photo(original.id) : null;
  if (!view.active()) return;
  replaceMarkup(screen, catchFields(original));
  if (original) {
    by('catch-length').value = original.lengthMm == null ? '' : String(original.lengthMm / 10);
    by('bait').value = original.bait || '';
    by('technique').value = original.technique || '';
  }
  const species = bindCatchSpecies(pack, trip, directory, original);
  view.refreshWaters = (edition) => species.setWater(tripWater(edition, trip));
  view.refreshWaters(waterDirectory);
  const positionInput = bindCatchPosition(view, original?.position);
  const photoInput = bindPhotoPreview(existingPhoto);
  by('camera-photo').onclick = (event) => {
    if (positionInput.waiting()) {
      event.preventDefault();
      toast(t('catch_form.wait_for_the_location_or_cancel_the'));
    }
  };
  view.dispose = () => {
    positionInput.dispose();
    photoInput.dispose();
  };
  bindBack(nav);
  trackEdits(by('form'), view);
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    if (view.saving) return;
    if (positionInput.waiting()) {
      toast(t('catch_form.wait_for_the_location_or_cancel_the'));
      return;
    }
    by('form-error').hidden = true;
    for (const invalid of by('form').querySelectorAll('[aria-invalid]')) {
      invalid.removeAttribute('aria-invalid');
      invalid.removeAttribute('aria-describedby');
    }
    const fish = species.record();
    if (!fish.speciesName) {
      toast(t('catch_form.enter_a_fish_species'));
      return;
    }
    let lengthMm, position;
    try {
      lengthMm = Domain.lengthMm(by('catch-length').value);
      position = positionInput.read();
    } catch (err) {
      if (err.message !== 'length') by('position-fields').open = true;
      const invalid = by(err.message === 'length' ? 'catch-length' : err.message);
      invalid.setAttribute('aria-invalid', 'true');
      invalid.setAttribute('aria-describedby', 'form-error');
      by('form-error').hidden = false;
      by('form-error').textContent =
        err.message === 'length'
          ? t('catch_form.enter_a_positive_length_in_centimetres')
          : t('catch_form.check_both_coordinates_latitude_90_longitude_180');
      invalid.focus();
      return;
    }
    const file = photoInput.file();
    const record = {
      ...original,
      id: catchId,
      tripId: id,
      created: original?.created ?? created,
      ...fish,
      lengthMm,
      position,
      capture: file ? photoInput.capture() || null : (original?.capture ?? null),
      bait: by('bait').value.trim(),
      technique: by('technique').value.trim(),
    };
    await writeEntry(
      view,
      nav,
      id,
      async () => {
        const photo = original && !file ? undefined : await pixelJpeg(file, 1920);
        // The original record lets IndexedDB reject an edit if another view has already changed it.
        await Journal.saveCatch(record, photo, original);
      },
      (error) =>
        toast(
          error.message === 'photo'
            ? t('catch_form.cannot_read_the_photo_choose_an_image')
            : t('catch_form.saving_failed_your_entry_is_still_here'),
        ),
    );
  };
}
/** Assemble the localized controls shared by new catches and edits to existing records. */
function catchFields(original) {
  const kinds = [
    ['stand', t('common.angler_position')],
    ['strike', t('common.strike_location')],
  ];
  return (
    back(t('common.trip')) +
    `<div class="page-intro"><div class="title-mark">${icon('fish')}</div><h1>${t(original ? 'trips.edit_catch' : 'catch_form.new_catch')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${catchSpeciesFields()}
    ${textInput('catch-length', t('catch_form.measured_length_cm'), '', 'inputmode="decimal" placeholder="' + exampleNumber.format(64.5) + '"')}
    <details id="catch-rules" class="fold" hidden><summary>${t('catch_picker.rules')}</summary><div class="fold-body" id="catch-rule-body"></div></details>
    <div class="photo-field"><input type="file" id="camera-photo" accept="image/*" capture="environment">
      <label for="camera-photo">${icon('camera')}${t('catch_form.photograph_catch_at_the_water')}</label>
    <small>${t('catch_form.photograph_the_whole_fish_with_a_ruler')}</small>
    ${showsCloudPhotoPolicy() ? '<small>' + t('retention.policy') + '</small>' : ''}
    <input type="file" id="photo" accept="image/*"><label for="photo">${icon('camera')}<span id="photo-label">
      ${t('catch_form.add_photo')}</span></label><small id="capture-state" role="status"></small><img id="photo-preview"
      class="preview" hidden alt=""></div></section>
  <details class="fold"><summary>${icon('fish-symbol')}${t('catch_form.bait_and_technique')}</summary>
    <div class="fold-body">${textInput('bait', t('catch_form.bait_or_lure'), '', 'maxlength="300"')}
    ${textInput('technique', t('catch-form.fishing.technique'), '', 'maxlength="500"')}</div></details>
  <details id="position-fields" class="fold"><summary>${icon('lock-keyhole')}${t('catch_form.private_location')}</summary>
    <div class="fold-body">${selectField('kind', t('catch_form.point_represents'), kinds, 'stand')}
  <div class="pair"><div>
    ${textInput('lat', t('catch_form.latitude'), '', 'placeholder="' + exampleNumber.format(49.8783) + '"')}</div><div>
    ${textInput('lon', t('catch_form.longitude'), '', 'placeholder="' + exampleNumber.format(14.4282) + '"')}</div></div>
  <div class="actions">${button('gps', t('catch_form.use_current_location'), 'secondary', 'locate-fixed')}</div><small>
    ${t('catch_form.for_older_photos_enter_the_location_manually')}</small></div></details>
  <p class="field-error" id="form-error" role="alert" hidden></p><div class="savebar"><button class="primary">
    ${icon('check')}${t('catch_form.save_catch')}</button></div></form>`
  );
}
