// Exercise the same public water from two separately authenticated Android installations.
export async function waterOnPhone(action, fixture, controls) {
  const { find, shown, expect, until, click, set, page, confirm } = controls;
  const water = '401009',
    note = 'Footpath beside the mill',
    answer = 'Confirmed from the bridge';
  const parking = 'Upper gravel pull-in',
    temporary = 'Temporary pickup point';
  const peerNote = 'Walk along the marked path',
    ownerNote = 'Owner access note';
  async function openWater(id = water) {
    await click('#tabwaters');
    if (!find('#search')) await click('#tabwaters');
    await page('waters');
    set('#search', id);
    await click('[data-water="' + id + '"]');
    await page('water');
  }
  async function discussion() {
    await openWater();
    await click('#open-discussion');
    await page('waterDiscussion');
    await until(() => shown(find('#discussion-compose')), 'water discussion loaded');
  }
  function post(text) {
    return [...document.querySelectorAll('article.discussion-post')].find(
      (el) => el.querySelector('.discussion-body')?.textContent === text,
    );
  }
  async function openPost(text) {
    (await until(() => post(text), 'posted observation')).querySelector('.actions button').click();
    await until(() => find('#discussion-root .discussion-body')?.textContent === text, 'discussion thread');
  }
  async function compose(text, cancelFirst = false) {
    await click('#discussion-compose');
    await page('discussionComposer');
    set('#discussion-text', text);
    find('#discussion-form').requestSubmit();
    if (cancelFirst) {
      await confirm(false);
      expect(find('#discussion-text').value === text, 'Cancellation discarded the observation');
      find('#discussion-form').requestSubmit();
    }
    await confirm(true);
    await until(() => post(text), 'saved discussion text');
  }
  function spot(name) {
    return [...document.querySelectorAll('#parking article')].find(
      (el) => el.querySelector('h3')?.textContent === name,
    );
  }
  async function addSpot(name, offset) {
    await click('#parking-add');
    await page('parkingEditor');
    expect(find('#parking-confirm').disabled, 'An unselected parking point can be submitted');
    const map = find('#parking-map #world-map');
    for (let n = 0; n < offset; n++)
      map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    set('#parking-name', name);
    await click('#parking-confirm');
    await confirm(false);
    expect(find('#parking-name').value === name, 'Parking draft lost after cancellation');
    await click('#parking-confirm');
    await confirm(true);
    await until(() => spot(name), 'published parking point');
  }
  async function feedback(card) {
    const details = card.querySelector('details');
    details.open = true;
    await until(() => details.querySelector('textarea'), 'parking feedback');
    return details;
  }
  async function review(card, text, stars) {
    const box = await feedback(card),
      noteField = box.querySelector('textarea'),
      rating = box.querySelector('select');
    set('#' + noteField.id, text);
    set('#' + rating.id, stars);
    const save = box.querySelector('button[id^="review-"]');
    expect(!save.disabled, 'Review change was not accepted by the form');
    save.click();
    await until(
      () =>
        !rating.disabled &&
        save.disabled &&
        (text
          ? [...box.querySelectorAll('li')].some((el) => el.textContent.includes(text))
          : !noteField.value),
      'persisted parking feedback',
    );
    return noteField.id.slice(5);
  }
  async function removeSpot(name, preserved) {
    (await until(() => spot(name), 'owner parking point')).querySelector('button[id^="edit-"]').click();
    await page('parkingEditor');
    await click('#parking-remove');
    await confirm(false);
    expect(find('#parking-name').value === name, 'Cancelled removal changed the point');
    await click('#parking-remove');
    await confirm(true);
    await page('water');
    await until(
      () =>
        find('#parking article') &&
        (preserved ? spot(name) && !spot(name).querySelector('button[id^="edit-"]') : !spot(name)),
      'parking removal result',
    );
  }
  if (action === 'water-create') {
    await discussion();
    await compose(note, true);
    await compose('Temporary observation');
    await openPost('Temporary observation');
    await click('#discussion-root .danger');
    await confirm(false);
    expect(!!post('Temporary observation'), 'Cancelled withdrawal hid the note');
    await click('#discussion-root .danger');
    await confirm(true);
    await until(() => post(note) && !post('Temporary observation'), 'withdrawn standalone observation');
    await openWater();
    await addSpot(parking, 1);
    await addSpot(temporary, 3);
    const card = spot(parking);
    const parkingId = await review(card, ownerNote, '3');
    const tempId = (await feedback(spot(temporary))).querySelector('textarea').id.slice(5);
    await removeSpot(temporary, false);
    return { parkingId, tempId };
  }
  if (action === 'water-peer') {
    await discussion();
    expect(!post('Temporary observation'), 'Withdrawn note visible to a new reader');
    await openPost(note);
    expect(!find('#discussion-root .danger'), 'Peer can withdraw the author’s observation');
    await compose(answer);
    await openWater();
    const card = await until(() => spot(parking), 'shared parking spot');
    expect(
      !card.querySelector('button[id^="edit-"]') && !spot(temporary),
      'Incorrect peer parking controls or deleted spot visible',
    );
    const box = await feedback(card);
    expect(
      box.querySelector('textarea').value === '' && box.textContent.includes(ownerNote),
      'Mixed own and peer parking notes',
    );
    await review(card, peerNote, '5');
    await review(card, '', '5');
    expect(
      !box.textContent.includes(peerNote) && box.textContent.includes(ownerNote),
      'Removing my note changed another note',
    );
    await review(card, peerNote, '5');
    return;
  }
  if (action === 'water-owner') {
    await discussion();
    await openPost(note);
    const reply = await until(() => post(answer), 'response on the original water');
    expect(
      !!find('#discussion-root .withdrawal-locked') && !find('#discussion-root .danger'),
      'Linked note permits withdrawal',
    );
    reply.querySelector('.mark-helpful').click();
    await until(() => post(answer)?.querySelector('.discussion-helpful'), 'marked peer response');
    await openWater('401001');
    await click('#open-discussion');
    await page('waterDiscussion');
    expect(!post(note) && !post(answer), 'A different water showed the same discussion');
    await openWater();
    const card = await until(() => spot(parking), 'owned parking point');
    const box = await feedback(card);
    expect(
      box.querySelector('textarea').value === ownerNote && box.textContent.includes(peerNote),
      'Details do not distinguish the two authors',
    );
    await removeSpot(parking, true);
    return;
  }
  if (action === 'water-reopen') {
    await openWater();
    const card = await until(() => spot(parking), 'community parking retained after withdrawal');
    const box = await feedback(card);
    expect(
      !card.querySelector('button[id^="edit-"]') && !box.textContent.includes(ownerNote),
      'Author controls or note survived withdrawal',
    );
    expect(
      box.querySelector('textarea').value === peerNote && box.querySelector('select').value === '5',
      'Peer feedback lost after restart',
    );
    await discussion();
    await openPost(note);
    await until(() => post(answer)?.querySelector('.discussion-helpful'), 'peer can see helpful mark');
    return;
  }
  throw Error('Unknown water action ' + action);
}
