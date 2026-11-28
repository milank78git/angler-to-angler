// This function is sent to the installed WebView by the existing device driver.
// Interact through the visible controls. The host verifies the committed state independently.
export async function communityOnPhone(action, fixture) {
  const find = (selector) => document.querySelector(selector);
  const shown = (element) => element && !element.closest('[hidden]') && !element.disabled;
  function expect(value, message) {
    if (!value) throw Error(message);
  }
  async function until(read, description) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const page = find('#screen')?.dataset.page;
    const controls = [...document.querySelectorAll('#screen button[id]')].filter(shown).map((el) => el.id);
    const feedback = [find('#notice')?.textContent, find('#screen [role="alert"]')?.textContent]
      .filter(Boolean)
      .join(' / ');
    throw Error(
      'Waiting for ' +
        description +
        ' on ' +
        page +
        ' (controls: ' +
        controls +
        ', feedback: ' +
        feedback +
        ')',
    );
  }
  async function click(selector) {
    const element = await until(() => shown(find(selector)) && find(selector), selector);
    element.click();
  }
  function set(selector, value) {
    const el = find(selector);
    expect(shown(el), 'Unavailable input ' + selector);
    el.value = value;
    expect(el.value === value, 'Input rejected value for ' + selector);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  async function page(name) {
    await until(
      () => find('#screen').dataset.page === name && !find('#screen').hasAttribute('aria-busy'),
      name,
    );
    expect(!find('#retry'), 'Application could not render ' + name);
  }
  async function confirm(accept) {
    await click('#confirmation[open] ' + (accept ? '#confirmation-accept' : '#confirmation-cancel'));
    await until(() => !find('#confirmation').open, 'confirmation to close');
  }
  async function market(shelf) {
    await click('#tabwaters');
    if (!find('#home-market')) await click('#tabwaters');
    await page('waters');
    await click('#home-market');
    await page('marketShelf');
    if (shelf !== 'browse') {
      await click('#shelf-' + shelf);
      await page('marketShelf');
      expect(find('#shelf-' + shelf).getAttribute('aria-pressed') === 'true', 'Wrong market shelf');
    }
  }
  const title = fixture.offerTitle || 'Evening at the weir ' + crypto.randomUUID().slice(0, 8);
  const original = 'Fish the sheltered bank after dusk.';
  const revised = 'Use the deeper channel after sunrise.';
  const listing = () =>
    [...document.querySelectorAll('#screen article')].find(
      (row) => row.querySelector('h3')?.textContent === title,
    );
  async function openListing() {
    const row = await until(listing, 'offer on selected shelf');
    row.querySelector('button').click();
    await page('marketDetail');
    expect(find('#screen h1').textContent === title, 'Opened another offer');
  }
  if (action === 'market-publish') {
    await market('mine');
    await click('#market-create');
    await page('marketEditor');
    set('#offer-title', title);
    set('#offer-country', 'CZ');
    set('#species-filter', 'Esox lucius');
    set('#offer-species', 'Esox lucius');
    set('#offer-technique', original);
    set('#offer-price', '23');
    set('#offer-limit', '2');
    await click('#market-preview');
    expect(
      !find('#confirmation-message').textContent.includes(original),
      'Public preview disclosed paid content',
    );
    await confirm(false);
    expect(find('#offer-technique').value === original, 'Cancelling publication lost the draft');
    await click('#market-preview');
    await confirm(true);
    await page('marketShelf');
    await openListing();
    expect(
      find('#market-technique')?.textContent === original && !find('#market-buy'),
      'Author rights or stored content incorrect',
    );
    return { offerTitle: title, seller: Device.subjectId() };
  }
  if (action === 'market-cancel-buy') {
    await market('browse');
    await openListing();
    expect(
      !find('#screen').textContent.includes(original) && !find('#market-edit'),
      'Buyer saw protected content or seller controls',
    );
    await click('#market-activate');
    await click('#market-buy');
    expect(
      find('#confirmation-message').textContent.includes(title) &&
        find('#confirmation-message').textContent.includes('23'),
      'Wrong purchase terms',
    );
    await confirm(false);
    expect(shown(find('#market-buy')) && !find('#market-technique'), 'Cancellation unlocked the content');
    return { buyer: Device.subjectId() };
  }
  if (action === 'market-lose-receipt' || action === 'market-retry') {
    await click('#market-buy');
    await confirm(true);
    if (action === 'market-lose-receipt') {
      const { label } = await import('./i18n.js');
      await until(
        () =>
          shown(find('#market-buy')) &&
          find('#notice')?.textContent === label('market.connection_failed_please_retry'),
        'retry after the lost receipt',
      );
      expect(!find('#market-technique'), 'UI claimed success without a purchase receipt');
    } else {
      await until(() => find('#market-technique')?.textContent === original, 'purchased technique');
      expect(!find('#market-buy'), 'Purchased offer still has a buy action');
    }
    return;
  }
  if (action === 'market-edit-and-withdraw') {
    await market('mine');
    await openListing();
    await click('#market-edit');
    await page('marketEditor');
    set('#offer-technique', revised);
    set('#offer-price', '37');
    await click('#market-preview');
    await confirm(true);
    await until(() => find('#market-technique')?.textContent === revised, 'stored seller revision');
    await click('#market-withdraw');
    await confirm(false);
    expect(shown(find('#market-edit')), 'Cancelled withdrawal removed seller controls');
    await click('#market-withdraw');
    await confirm(true);
    await until(
      () => !find('#market-withdraw') && find('#market-technique')?.textContent === revised,
      'withdrawn offer detail',
    );
    return;
  }
  if (action === 'market-reopen') {
    await market('browse');
    expect(!listing(), 'Withdrawn offer still discoverable');
    await click('#shelf-purchased');
    await page('marketShelf');
    await openListing();
    expect(
      find('#market-technique')?.textContent === original,
      'Buyer lost the purchased revision after restart',
    );
    expect(
      !find('#screen').textContent.includes(revised) && !find('#market-buy'),
      'Later seller revision or a second charge offered to buyer',
    );
    return;
  }

  // Create the trip and catch through both forms, then publish a month-only card.
  if (action === 'card-draft') {
    await click('#tabtrips');
    if (!find('#add-trip')) await click('#tabtrips');
    await page('trips');
    await click('#add-trip');
    await page('newTrip');
    set('#water-search', 'Private reed bed');
    await click('#use-water-name');
    set('#day', '2024-05-17');
    set('#notes', 'Private landing coordinates 49.6001');
    find('#form').requestSubmit();
    await page('trip');
    await click('#add');
    await page('newCatch');
    set('#fish', 'manual');
    set('#fish-name', 'Field perch');
    set('#bait', 'Private bait');
    set('#technique', 'Private technique');
    find('#form').requestSubmit();
    await page('trip');
    const source = (await until(() => find('[data-public-catch]'), 'new private catch')).dataset.publicCatch;
    await click('[data-public-catch]');
    await page('publicCardEditor');
    expect(
      !find('#public-day').checked && !find('#public-water'),
      'Private water or exact day selected by default',
    );
    const preview = find('#public-preview');
    expect(
      preview.querySelector('time')?.dateTime === '2024-05' && !preview.textContent.includes('Private'),
      'Private trip fields reached preview',
    );
    await click('#public-publish');
    await confirm(false);
    expect(
      !find('#screen .actions a[href*="#"]') && shown(find('#public-publish')),
      'Cancelling publication created a link',
    );
    return { cardSource: source };
  }
  if (action === 'card-publish') {
    await click('#public-publish');
    await confirm(true);
    const link = await until(() => find('#screen .actions a[href*="#"]'), 'published link');
    return { cardToken: new URL(link.href).hash.slice(1) };
  }
  if (action === 'card-cancel-revoke' || action === 'card-revoke') {
    await click('#screen .actions button.danger');
    await confirm(action === 'card-revoke');
    if (action === 'card-revoke')
      await until(() => shown(find('#public-publish')), 'fresh public card editor');
    else
      expect(
        new URL(find('#screen .actions a').href).hash.slice(1) === fixture.cardToken,
        'Cancellation replaced the public link',
      );
    return;
  }
  throw Error('Unknown community action ' + action);
}
