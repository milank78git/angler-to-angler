'use strict';
const uid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );
const tripName = (r) => r.waterName;
const displayDay = (day) =>
  new Intl.DateTimeFormat(cs ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(day + 'T12:00:00Z'),
  );
function field(id, label, html) {
  return '<label for="' + id + '">' + esc(label) + '</label>' + html;
}
function textInput(id, label, value = '', attrs = '') {
  return field(id, label, '<input id="' + id + '" value="' + esc(value) + '" ' + attrs + '>');
}
function dirty(form) {
  form.oninput = () => {
    draft = true;
  };
}
function saved(page, props) {
  draft = false;
  if (page === 'trip') showSavedTrip(props.id);
  else {
    stacks.trips = [{ page: 'trips' }];
    go(page, props);
  }
}
async function listTrips() {
  const version = viewVersion;
  const [trips, counts] = await Promise.all([Journal.trips(), Journal.catchCounts()]);
  if (version !== viewVersion) return;
  trips.sort((a, b) => b.day.localeCompare(a.day) || b.created - a.created);
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  screen.innerHTML = `<section class="journal-head"><div class="journal-art" aria-hidden="true">${icon('book-open')}</div>
    <h1>${t('Můj deník', 'My journal')}</h1><p>${icon('lock-keyhole')}${t('Soukromě v tomto telefonu', 'Private on this phone')}</p>
    <div class="metrics"><span><strong>${trips.length}</strong>${t('Výpravy', 'Trips')}</span><span><strong>${total}</strong>${t('Úlovky', 'Catches')}</span></div></section>
    <div class="list-heading"><h2>${t('Moje výpravy', 'My trips')}</h2>${button('add-trip', t('Nová výprava', 'New trip'), 'primary', 'plus')}</div>
    <div class="trip-list">${
      trips
        .map((trip) => {
          const d = new Date(trip.day + 'T12:00:00Z'),
            locale = cs ? 'cs-CZ' : 'en-GB',
            count = counts.get(trip.id) || 0;
          return `<button class="trip-row" data-trip="${esc(trip.id)}"><span class="date-stamp" aria-hidden="true"><strong>${d.getUTCDate()}</strong>${esc(d.toLocaleString(locale, { month: 'short', timeZone: 'UTC' }))}</span>
        <span class="row-main"><span class="number">${esc(displayDay(trip.day))}</span><strong>${esc(trip.waterName)}</strong><span class="sub">${t('Úlovky', 'Catches')} · ${count}${trip.notes ? ' · ' + esc(trip.notes.slice(0, 90)) : ''}</span></span>${icon('chevron-right')}</button>`;
        })
        .join('') ||
      emptyState(
        'notebook-pen',
        t('Zapiš první výpravu', 'Log your first trip'),
        t(
          'Zůstane v deníku, i když tentokrát nic nezabere.',
          'A day on the water belongs here even without a catch.',
        ),
      )
    }</div>`;
  bind('add-trip', () => go('newTrip'));
  screen
    .querySelectorAll('[data-trip]')
    .forEach((b) => (b.onclick = () => go('trip', { id: b.dataset.trip })));
}
function tripForm() {
  const selected = route.water || '';
  screen.innerHTML =
    back(t('Zpět', 'Back')) +
    `<div class="page-intro"><div class="title-mark">${icon('notebook-pen')}</div><h1>${t('Nová výprava', 'New trip')}</h1></div>
  <form id="form" class="entry-form"><section class="surface">${field('water', t('Revír nebo voda', 'Fishing water'), '<select id="water">' + options([['', t('Vlastní voda', 'Other water')], ...pack.waters.map((w) => [w.id, w.name])], selected) + '</select>')}
  <div id="custom">${textInput('water-name', t('Název vody', 'Water name'), '', 'maxlength="100"')}</div>
  ${textInput('day', t('Datum výpravy', 'Trip date'), Domain.today(selected ? pack.zone : undefined), 'type="date" required')}
  ${field('notes', t('Poznámky', 'Notes'), '<textarea id="notes" maxlength="4000" rows="3"></textarea>')}</section>
  <div class="savebar"><button class="primary">${icon('check')}${t('Uložit výpravu', 'Save trip')}</button></div></form>`;
  bindBack();
  dirty(by('form'));
  function custom() {
    by('custom').hidden = !!by('water').value;
    by('water-name').required = !by('water').value;
  }
  by('water').onchange = custom;
  custom();
  const id = uid(),
    created = Date.now();
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    const w = pack.waters.find((w) => w.id === by('water').value),
      name = w ? w.name : by('water-name').value.trim(),
      day = by('day').value;
    if (!name || !Domain.validDay(day)) {
      toast(t('Vyplň název vody a datum.', 'Enter a water name and a valid date.'));
      return;
    }
    const submit = e.target.querySelector('.primary');
    submit.disabled = true;
    try {
      await Journal.saveTrip({
        id,
        created,
        waterId: w ? w.id : null,
        packId: w ? pack.id : null,
        country: w ? pack.country : null,
        zone: w ? pack.zone : Intl.DateTimeFormat().resolvedOptions().timeZone,
        waterName: name,
        day,
        notes: by('notes').value.trim(),
      });
      saved('trip', { id });
    } catch (err) {
      submit.disabled = false;
      toast(t('Uložení selhalo. Zápis můžeš zkusit znovu.', 'Saving failed. You can retry.'));
    }
  };
}
async function tripScreen() {
  const version = viewVersion,
    id = route.id;
  const [trip, catches] = await Promise.all([Journal.trip(id), Journal.catches(id)]);
  if (version !== viewVersion) return;
  if (!trip) {
    go('trips');
    return;
  }
  const images = [],
    cleanup = () => images.forEach((url) => URL.revokeObjectURL(url));
  disposeView = cleanup;
  screen.innerHTML =
    back(t('Můj deník', 'My journal')) +
    '<p class="meta">' +
    displayDay(trip.day) +
    '</p><h1>' +
    esc(trip.waterName) +
    '</h1>' +
    (trip.notes ? '<p class="trip-note">' + esc(trip.notes) + '</p>' : '') +
    '<div class="actions">' +
    button('add', t('Přidat úlovek', 'Add catch'), 'primary', 'plus') +
    '</div><h2>' +
    t('Úlovky', 'Catches') +
    ' · ' +
    catches.length +
    '</h2><div id="catch-list"></div><div class="actions">' +
    button('delete', t('Smazat výpravu', 'Delete trip'), 'danger') +
    '</div>';
  bindBack();
  bind('add', () => go('newCatch', { id }));
  bind('delete', async () => {
    if (
      !confirm(
        t(
          'Smazat tuto výpravu včetně úlovků, fotek a souřadnic?',
          'Delete this trip with all catches, photos and coordinates?',
        ),
      )
    )
      return;
    try {
      await Journal.removeTrip(id);
      saved('trips');
    } catch (e) {
      toast(t('Smazání selhalo.', 'Deletion failed.'));
    }
  });
  by('catch-list').innerHTML = catches.length
    ? ''
    : '<p class="empty">' + t('Zapsaná výprava bez úlovku.', 'A trip with no catches recorded.') + '</p>';
  for (const c of catches.sort((a, b) => a.created - b.created)) {
    const article = document.createElement('article');
    article.className = 'surface catch-card';
    by('catch-list').append(article);
    const position = c.position,
      label =
        position?.kind === 'strike'
          ? t('Místo záběru', 'Strike location')
          : t('Stanoviště rybáře', 'Angler position');
    const fmt = (n) =>
      new Intl.NumberFormat(cs ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 1 }).format(n);
    article.innerHTML =
      '<h3>' +
      esc(c.speciesId ? loc(pack.species[c.speciesId]) : c.speciesName) +
      '</h3>' +
      (c.lengthMm
        ? '<p>' + fmt(c.lengthMm / 10) + ' cm · ' + t('ruční zápis', 'manually entered') + '</p>'
        : '') +
      (c.bait ? '<p>' + t('Nástraha', 'Bait') + ' · ' + esc(c.bait) + '</p>' : '') +
      (c.technique ? '<p>' + t('Technika', 'Technique') + ' · ' + esc(c.technique) + '</p>' : '') +
      (position
        ? '<p class="meta">' +
          label +
          ' · ' +
          position.lat.toFixed(5) +
          ', ' +
          position.lon.toFixed(5) +
          ' · ' +
          (position.source === 'device' ? 'GPS' : t('ručně', 'manual')) +
          (Number.isFinite(position.accuracy) ? ' ±' + Math.round(position.accuracy) + ' m' : '') +
          '</p>'
        : '');
    if (c.hasPhoto) {
      const blob = await Journal.photo(c.id);
      if (version !== viewVersion) return;
      if (blob) {
        const url = URL.createObjectURL(blob);
        images.push(url);
        const img = new Image();
        img.className = 'preview';
        img.alt = t('Fotografie úlovku', 'Catch photograph');
        img.src = url;
        article.prepend(img);
      }
    }
  }
}
/** Decode and re-encode into pixels only, dropping source EXIF and location metadata. */
async function journalPhoto(file) {
  if (!file) return null;
  if (file.size > 30 * 1024 * 1024) throw Error('photo');
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
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
let currentFix = null,
  awaitingFix = false;
function positionResult(fix) {
  if (route.page !== 'newCatch' || !awaitingFix || !by('gps')) return;
  awaitingFix = false;
  by('gps').disabled = false;
  by('gps').textContent = t('Použít současnou polohu', 'Use current location');
  if (!fix) return;
  currentFix = fix;
  by('lat').value = fix.lat.toFixed(6);
  by('lon').value = fix.lon.toFixed(6);
  draft = true;
}
function catchForm() {
  const id = route.id,
    catchId = uid(),
    created = Date.now();
  currentFix = null;
  awaitingFix = false;
  disposeView = () => {
    awaitingFix = false;
    currentFix = null;
    if (window.Device) Device.cancelLocation();
  };
  screen.innerHTML = catchFields();
  let preview;
  const release = disposeView;
  disposeView = () => {
    if (preview) URL.revokeObjectURL(preview);
    release();
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
  bindBack();
  dirty(by('form'));
  by('fish-name').required = true;
  by('fish').onchange = () => {
    by('custom-fish').hidden = !!by('fish').value;
    by('fish-name').required = !by('fish').value;
  };
  const clearFix = () => {
    currentFix = null;
    awaitingFix = false;
    by('gps').disabled = false;
    by('gps').textContent = t('Použít současnou polohu', 'Use current location');
    if (window.Device) Device.cancelLocation();
  };
  by('lat').oninput = clearFix;
  by('lon').oninput = clearFix;
  bind('gps', () => {
    if (!window.Device) {
      toast(t('GPS je dostupná na Androidu.', 'GPS is available on Android.'));
      return;
    }
    awaitingFix = true;
    by('gps').disabled = true;
    by('gps').textContent = t('Hledám polohu…', 'Waiting for position…');
    Device.location();
  });
  by('form').onsubmit = async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('.primary');
    if (submit.disabled) return;
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
      const invalid = by(err.message === 'length' ? 'length' : 'lat');
      invalid.focus();
      by('form-error').hidden = false;
      by('form-error').textContent =
        err.message === 'length'
          ? t('Uveď kladnou délku v centimetrech.', 'Enter a positive length in centimetres.')
          : t(
              'Zkontroluj obě souřadnice (šířka ±90°, délka ±180°).',
              'Check both coordinates (latitude ±90°, longitude ±180°).',
            );
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
    const file = by('photo').files[0],
      version = viewVersion;
    const record = {
      id: catchId,
      tripId: id,
      created,
      speciesId: speciesId || null,
      speciesName: speciesId ? null : speciesName,
      lengthMm,
      position,
      bait: by('bait').value.trim(),
      technique: by('technique').value.trim(),
      hasPhoto: !!file,
    };
    submit.disabled = true;
    try {
      const photo = await journalPhoto(file);
      if (version !== viewVersion) return;
      await Journal.saveCatch(record, photo);
      if (version === viewVersion) saved('trip', { id });
    } catch (err) {
      submit.disabled = false;
      toast(
        t(
          'Úlovek se neuložil. Ověř volné místo a použij fotografii do 30 MB.',
          'Could not save the catch. Check available space and use a photo under 30 MB.',
        ),
      );
    }
  };
}
function catchFields() {
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
