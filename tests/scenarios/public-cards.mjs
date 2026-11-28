import assert from 'node:assert/strict';
import {renderPublicCard} from '../../app/src/main/assets/public-card-view.js';
import {label, languageTag} from '../../app/src/main/assets/i18n.js';

// Every privacy choice can change when the same reader opens the next angler's link.
function* cards(owner) {
  for (const precision of ['day', 'month']) for (const water of [false, true]) {
    for (const photo of [false, true]) for (const kind of ['none', 'measured', 'estimated']) {
      yield {id: [precision, water, photo, kind].join('-'), card: {
        species: `Fish <${owner}>`, name: owner, precision, date: precision === 'month' ? '2028-02' : '2028-02-29',
        water: water ? `Water ${owner}` : null, photo: photo ? btoa(owner) : null,
        length: kind === 'none' ? null : {kind, mm: 527}, notes: 'private journal note', gps: 'private location',
      }};
    }
  }
}
export async function run({check, words, locale}) {
  const host = document.createElement('main');
  for (const previous of cards('previous-angler')) for (const next of cards('current-angler')) {
    await check(`${previous.id}/${next.id}`, () => {
      renderPublicCard(host, previous.card, languageTag, label);
      const old = host.firstChild;
      renderPublicCard(host, next.card, languageTag, label);
      const card = next.card, month = card.precision === 'month';
      assert.equal(host.children.length, 1);
      assert.ok(!host.contains(old));
      assert.equal(host.querySelector('h2').textContent, card.species);
      assert.equal(host.querySelector('.public-catch-author').textContent, card.name);
      assert.doesNotMatch(host.outerHTML, /previous-angler|private journal note|private location/);
      const date = new Date(month ? '2028-02-01T12:00Z' : '2028-02-29T12:00Z');
      const expected = [[words(month ? 'public_card.catch_month' : 'public_card.catch_date'),
        date.toLocaleDateString(locale, {month: 'long', year: 'numeric', ...(month ? {} : {day: 'numeric'}), timeZone: 'UTC'})]];
      if (card.water) expected.push([words('common.water'), card.water]);
      if (card.length) expected.push([words(card.length.kind === 'measured' ? 'public_card.length_from_ruler' : 'public_card.reference_based_estimate'),
        (52.7).toLocaleString(locale) + ' cm']);
      assert.deepEqual([...host.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]), expected);
      assert.equal(host.querySelector('time').dateTime, card.date);
      const images = host.querySelectorAll('img');
      assert.equal(images.length, Number(!!card.photo));
      if (card.photo) { assert.equal(images[0].getAttribute('src'), 'data:image/webp;base64,' + card.photo); assert.equal(images[0].alt, card.species); }
    });
  }
}
