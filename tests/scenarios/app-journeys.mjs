import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { groupSharingJourneys } from './group-sharing-journeys.mjs';
import { purchaseJourneys } from './market-journeys.mjs';
import { Journal } from '../../app/src/main/assets/journal.js';

// Synchronize on the production renderer's ready signal instead of an arbitrary sleep.
async function mounted(page) {
  const host = document.getElementById('screen');
  const deadline = Date.now() + 5000;
  while (host.dataset.page !== page || host.hasAttribute('aria-busy')) {
    if (Date.now() >= deadline)
      assert.fail(`Awaited ${page}, saw ${host.dataset.page}: ${host.textContent.slice(0, 160)}`);
    await nextTurn();
  }
  assert.equal(host.querySelector('#retry'), null, `Render failed: ${page}`);
  return host;
}

export async function run({ check, words, locale }) {
  const field = (id) => document.getElementById(id);
  Object.assign(window.Device, {
    subjectId: () => 'journey-owner',
    networkCountry: () => 'CZ',
    nightMode: () => false,
    watching: () => false,
    profileRequest: (id, op) =>
      queueMicrotask(() => window.profileReply(id, op === 'my_details' ? 200 : 503, {})),
  });
  localStorage.setItem('journal.sync.v1.journey-owner.enabled', '0');
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  await import('../../app/src/main/assets/boot.js');
  await mounted('waters');
  async function tab(key) {
    field('tab' + key).click();
    return mounted(key);
  }
  await check('atlas/country-order-and-number-search', async () => {
    await tab('waters');
    const select = field('water-country');
    const labels = [...select.options].filter((opt) => opt.value).map((opt) => opt.textContent);
    assert.deepEqual(labels, [...labels].sort(new Intl.Collator(locale).compare));
    assert.equal(select.value, 'CZ');
    const search = field('search');
    search.value = '401 009';
    search.dispatchEvent(new Event('input'));
    const result = document.querySelector('[data-water="401009"]');
    assert.ok(result);
    result.click();
    await mounted('water');
    assert.equal(window.handleBack(), true);
    await mounted('waters');
    assert.equal(field('search').value, '401 009');
  });
  await check('journal/new-private-water-save-and-reopen', async () => {
    await tab('trips');
    field('add-trip').click();
    await mounted('newTrip');
    field('water-search').value = 'Private test pond';
    field('water-search').dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(field('water-search').validationMessage, words('trips.confirm_water'));
    field('use-water-name').click();
    assert.equal(field('water-name').value, 'Private test pond');
    field('day').value = '2028-02-29';
    field('notes').value = '  private journal note  ';
    field('form').requestSubmit();
    await mounted('trip');
    assert.equal(document.querySelector('#screen h1').textContent, 'Private test pond');
    const saved = (await Journal.listTrips()).find((row) => row.waterName === 'Private test pond');
    assert.deepEqual(
      [saved.waterId, saved.country, saved.day, saved.notes],
      [null, null, '2028-02-29', 'private journal note'],
    );
    field('back').click();
    await mounted('trips');
    document.querySelector(`[data-trip="${saved.id}"]`).click();
    await mounted('trip');
    assert.equal(document.querySelector('.trip-note').textContent, 'private journal note');
    await Journal.removeTrip(saved.id);
  });
  await check('journal/back-keep-then-discard-dirty-draft', async () => {
    await tab('trips');
    field('add-trip').click();
    await mounted('newTrip');
    field('notes').value = 'keep this draft';
    field('notes').dispatchEvent(new Event('input', { bubbles: true }));
    const before = await Journal.tripKeys();
    assert.equal(window.handleBack(), true);
    assert.ok(field('confirmation').open);
    assert.equal(field('confirmation-title').textContent, words('journal.discard_unsaved_changes'));
    field('confirmation-cancel').click();
    await nextTurn();
    assert.equal(field('notes').value, 'keep this draft');
    assert.equal(field('confirmation').open, false);
    assert.equal(window.handleBack(), true);
    field('confirmation-accept').click();
    await mounted('trips');
    assert.deepEqual(await Journal.tripKeys(), before);
  });
  await check('home/catalogue-filter-and-detail', async () => {
    await tab('waters');
    field('home-fish').click();
    await mounted('fishCatalogue');
    const country = field('fish-country');
    country.value = 'CZ';
    country.dispatchEvent(new Event('change'));
    const query = field('fish-query');
    query.value = 'Esox lucius';
    query.dispatchEvent(new Event('input'));
    const results = field('fish-results').querySelectorAll('button');
    assert.equal(results.length, 1);
    results[0].click();
    await mounted('fishDetail');
    assert.ok(field('screen').textContent.includes('Esox lucius'));
    assert.equal(window.handleBack(), true);
    await mounted('fishCatalogue');
    assert.equal(field('fish-query').value, 'Esox lucius');
  });
  await purchaseJourneys({ check, words, mounted, tab });
  await groupSharingJourneys({ check, words, mounted, tab });
}
