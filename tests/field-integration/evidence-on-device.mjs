// A synthetic JPEG and location sample replace the camera hardware. The rest of this journey uses
// the installed forms, local journal, native RPC bridge, real reviewer account and stored decision.
export async function evidenceOnPhone(action, fixture, controls) {
  const { find, expect, until, click, set, page, confirm } = controls;
  const { Journal } = await import('./journal.js');
  const { today } = await import('./domain.js');
  const { label } = await import('./i18n.js');
  const pond = 'Reed bed field test',
    species = 'Field tench';
  async function trips() {
    await click('#tabtrips');
    if (!find('#add-trip')) await click('#tabtrips');
    await page('trips');
  }
  async function evidence() {
    await click('#profile');
    await page('anglerProfile');
    await click('#evidence');
    await page('evidence');
  }
  if (action === 'proof-create') {
    await trips();
    await click('#add-trip');
    await page('newTrip');
    set('#water-search', pond);
    await click('#use-water-name');
    set('#notes', 'Private trip notes');
    const day = today(Intl.DateTimeFormat().resolvedOptions().timeZone);
    set('#day', day);
    find('#form').requestSubmit();
    await page('trip');
    await click('#add');
    await page('newCatch');
    set('#fish', 'manual');
    set('#fish-name', species);
    set('#catch-length', '30.1');
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#27693f';
    ctx.fillRect(0, 0, 80, 40);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg'));
    const selected = new DataTransfer();
    selected.items.add(new File([jpeg], 'field-tench.jpg', { type: 'image/jpeg' }));
    find('#photo').files = selected.files;
    find('#photo').dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => !find('#photo-preview').hidden, 'gallery photo preview');
    find('#form').requestSubmit();
    await page('trip');
    const edit = await until(() => find('[data-edit-catch]'), 'saved catch');
    const id = edit.dataset.editCatch,
      original = await Journal.catchById(id);
    expect(
      original.lengthMm === 301 && original.hasPhoto && !original.capture && !find('[data-verify-catch]'),
      'Gallery photo was eligible for review',
    );
    // Supply the captured-at/fix sample a real camera would attach to the record. Keep its saved JPEG.
    const savedPhoto = await Journal.photo(id);
    expect(savedPhoto.type === 'image/jpeg' && savedPhoto.size > 0, 'Form did not store a JPEG');
    const stamp = Date.now();
    await Journal.saveCatch(
      { ...original, capture: { captured: stamp, fixed: stamp, accuracy: 8, lat: 4960, lon: 1460 } },
      undefined,
      original,
    );
    await trips();
    await click('[data-trip="' + original.tripId + '"]');
    await page('trip');
    await click('[data-edit-catch]');
    await page('newCatch');
    set('#catch-length', '31.5');
    set('#bait', 'Private bait sample');
    find('#form').requestSubmit();
    await page('trip');
    const edited = await Journal.catchById(id),
      photo = await Journal.photo(id);
    const bytes = async (file) => new Uint8Array(await file.arrayBuffer());
    const stored = await bytes(photo),
      input = await bytes(savedPhoto);
    expect(
      edited.lengthMm === 315 &&
        edited.bait === 'Private bait sample' &&
        stored.length === input.length &&
        stored.every((b, i) => b === input[i]),
      'Editing catch changed its JPEG or measurement',
    );
    await click('[data-verify-catch]');
    await confirm(false);
    expect(!!find('[data-verify-catch]'), 'Cancelled submission lost the local action');
    return { proofId: id, proofTrip: original.tripId };
  }
  if (action === 'proof-submit') {
    await click('[data-verify-catch]');
    await confirm(true);
    await page('evidence');
    expect(
      find('#screen').textContent.includes(species) &&
        find('#screen').textContent.includes(label('verification.awaiting_review')),
      'Missing pending evidence',
    );
    expect(!find('#review'), 'Author was offered reviewer controls');
    return;
  }
  if (action === 'proof-review') {
    await evidence();
    expect(!find('[data-remove="' + fixture.proofId + '"]'), 'Reviewer can delete owner evidence');
    await click('#review');
    await page('review');
    expect(
      find('#screen h2')?.textContent === species &&
        find('.review-image')?.src.startsWith('data:image/jpeg;base64,'),
      'Reviewer received different evidence',
    );
    set('#outcome', 'measured');
    set('#review-length', '');
    expect(!find('#decision').checkValidity(), 'Measured verdict accepts a missing length');
    set('#outcome', 'unverified');
    expect(find('#review-length').disabled, 'Unverified verdict requested a measurement');
    set('#outcome', 'measured');
    set('#review-length', '31.7');
    find('#decision').requestSubmit();
    await until(
      () =>
        !find('#decision') &&
        find('#screen').textContent.includes(
          label('verification.no_other_anglers_photos_are_awaiting_review'),
        ),
      'reviewed evidence left queue',
    );
    return;
  }
  if (action === 'proof-cleanup') {
    await evidence();
    const id = fixture.proofId,
      trip = fixture.proofTrip;
    const selector = '[data-remove="' + id + '"]',
      row = find(selector)?.closest('article');
    const measurement = new Intl.NumberFormat(document.documentElement.lang, {
      maximumFractionDigits: 1,
    }).format(31.7);
    expect(
      row?.textContent.includes(measurement + ' cm') &&
        row.textContent.includes(label('verification.photo_documented')),
      'Owner cannot see the reviewer measurement after restart',
    );
    await click(selector);
    await confirm(false);
    expect(!!find(selector), 'Cancelled withdrawal hid the decision');
    await click(selector);
    await confirm(true);
    await until(
      () => !find(selector) && !find('#screen').hasAttribute('aria-busy'),
      'withdrawn evidence removed',
    );
    expect(
      (await Journal.catchById(id)).lengthMm === 315 && (await Journal.photo(id)).size > 0,
      'Withdrawing verification deleted private catch data',
    );
    await trips();
    await click('[data-trip="' + trip + '"]');
    await page('trip');
    await click('[data-remove-catch="' + id + '"]');
    await confirm(false);
    expect(!!find('[data-edit-catch]'), 'Cancelled removal deleted the catch');
    await click('[data-remove-catch="' + id + '"]');
    await confirm(true);
    await until(() => !find('[data-edit-catch]') && find('#delete'), 'removed catch');
    expect(
      !(await Journal.catchById(id)) && !(await Journal.photo(id)) && !!(await Journal.trip(trip)),
      'Deleting the catch retained the photo or erased its trip',
    );
    const otherIds = (await Journal.tripKeys()).filter((key) => key !== trip).sort();
    expect(otherIds.length > 0, 'No unrelated private trips available as a control');
    await click('#delete');
    await confirm(false);
    await click('#delete');
    await confirm(true);
    await page('trips');
    expect(
      !find('[data-trip="' + trip + '"]') &&
        JSON.stringify((await Journal.tripKeys()).sort()) === JSON.stringify(otherIds),
      'Deleting one trip affected another trip',
    );
    return;
  }
  throw Error('Unknown evidence action ' + action);
}
