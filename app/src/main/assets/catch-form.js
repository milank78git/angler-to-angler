import { fishDirectory, fishOption } from './fish-catalogue.js';
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
    by('photo-label').textContent = file
      ? t('catch_form.change_photo')
      : t('catch_form.add_photo');
  }
  by('photo').onchange = (e) => choose(e.target, false);
  by('camera-photo').onchange = (e) => choose(e.target, true);
  return {
    file: () => file || by('photo').files[0],
    capture: () => capture,
    dispose() {
      window.Device?.releaseCameraPhoto?.();
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
      toast(t('catch_form.wait_for_the_location_or_cancel_the'));
    }
  };
  view.dispose = () => {
    positionInput.dispose();
    photoInput.dispose();
  };
  bindBack(nav);
  trackEdits(by('form'), view);
  const fishSelect = by('fish');
  const known = new Set(Object.values(pack.species).map(s => s.latin));
  fishDirectory().then(directory => {
    if (!view.active()) return;
    const group = document.createElement('optgroup');
    group.label = t('fish_catalogue.title');
    directory.species.filter(f => !known.has(f.latin)).sort((a,b) => a.label.localeCompare(b.label))
      .forEach(f => group.append(new Option(fishOption(f), f.latin)));
    fishSelect.append(group);
  }).catch(() => { /* A private catch can always use a locally entered name. */ });
  by('fish-name').required = true;
  by('fish').onchange = () => {
    by('custom-fish').hidden = !!by('fish').value;
    by('fish-name').required = !by('fish').value;
  };
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
    const speciesId = by('fish').value,
      speciesName = by('fish-name').value.trim();
    if (!speciesId && !speciesName) {
      toast(t('catch_form.enter_a_fish_species'));
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
          ? t('catch_form.enter_a_positive_length_in_centimetres')
          : t('catch_form.check_both_coordinates_latitude_90_longitude_180');
      invalid.focus();
      return;
    }
    const file = photoInput.file();
    const record = {
      id: catchId,
      tripId: id,
      created,
      speciesId: speciesId || null,
      speciesName: speciesId ? (pack.species[speciesId] ? loc(pack.species[speciesId]) : fishSelect.selectedOptions[0].textContent) : speciesName,
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
            ? t('catch_form.cannot_read_the_photo_choose_an_image')
            : t('catch_form.saving_failed_your_entry_is_still_here'),
        ),
    );
  };
}
function catchFields(pack) {
  const fish = [
    ['', t('catch-form.other.species')],
    ...Object.entries(pack.species).map(([id, species]) => [id, loc(species)]),
  ];
  const kinds = [
    ['stand', t('common.angler_position')],
    ['strike', t('common.strike_location')],
  ];
  return (
    back(t('common.trip')) +
    `<div class="page-intro"><div class="title-mark">${icon('fish')}</div><h1>${t('catch_form.new_catch')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${selectField('fish', t('common.fish_species'), fish, '')}
    <div id="custom-fish">${textInput('fish-name', t('catch_form.species_name'), '', 'maxlength="100"')}</div>
    ${textInput('length', t('catch_form.measured_length_cm'), '', 'inputmode="decimal" placeholder="64,5"')}
    <div class="photo-field"><input type="file" id="camera-photo" accept="image/*" capture="environment"><label for="camera-photo">${icon('camera')}${t('catch_form.photograph_catch_at_the_water')}</label>
    <small>${t('catch_form.photograph_the_whole_fish_with_a_ruler')}</small>
    <input type="file" id="photo" accept="image/*"><label for="photo">${icon('camera')}<span id="photo-label">${t('catch_form.add_photo')}</span></label><small id="capture-state" role="status"></small><img id="photo-preview" class="preview" hidden alt=""></div></section>
  <details class="fold"><summary>${icon('fish-symbol')}${t('catch_form.bait_and_technique')}</summary><div class="fold-body">${textInput('bait', t('catch_form.bait_or_lure'), '', 'maxlength="300"')}${textInput('technique', t('catch-form.fishing.technique'), '', 'maxlength="500"')}</div></details>
  <details id="position-fields" class="fold"><summary>${icon('lock-keyhole')}${t('catch_form.private_location')}</summary><div class="fold-body">${selectField('kind', t('catch_form.point_represents'), kinds, 'stand')}
  <div class="pair"><div>${textInput('lat', t('catch_form.latitude'), '', 'placeholder="49.8783"')}</div><div>${textInput('lon', t('catch_form.longitude'), '', 'placeholder="14.4282"')}</div></div>
  <div class="actions">${button('gps', t('catch_form.use_current_location'), 'secondary', 'locate-fixed')}</div><small>${t('catch_form.for_older_photos_enter_the_location_manually')}</small></div></details>
  <p class="field-error" id="form-error" role="alert" hidden></p><div class="savebar"><button class="primary">${icon('check')}${t('catch_form.save_catch')}</button></div></form>`
  );
}
