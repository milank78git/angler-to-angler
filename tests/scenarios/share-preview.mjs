import assert from 'node:assert/strict';
import { Journal } from '../../app/src/main/assets/journal.js';
import { shareCard } from '../../app/src/main/assets/share-card.js';

const by = (id) => document.getElementById(id);
const trip = {
  id: 'share-fixture',
  day: '2028-02-29',
  waterName: 'Fixture pond',
  note: 'Private trip note',
  gps: 'Private position',
};
const entry = {
  id: 'share-entry',
  tripId: trip.id,
  speciesName: 'Fixture fish',
  lengthMm: 527,
  bait: 'Corn',
  technique: 'Float',
  note: 'Private catch note',
};

export async function run({ check, words, locale }) {
  await Journal.saveTrip(trip);
  await Journal.saveCatch(entry);
  const pack = { species: {} };
  const view = { route: { tripId: trip.id, catchId: entry.id }, active: () => true };
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const options = [
    ['length', 'share_card.length', new Intl.NumberFormat(locale).format(52.7) + ' cm'],
    ['day', 'common.trip_date', formatter.format(new Date('2028-02-29T12:00:00Z'))],
    ['water', 'common.water', trip.waterName],
    ['bait', 'common.bait', entry.bait],
    ['technique', 'common.technique', entry.technique],
  ];
  const original = window.Device.shareCatch;
  try {
    // Capture what leaves the bridge and compare it to an independent allowlist, including the empty selection.
    for (const tip of ['', 'Look upstream'])
      for (let mask = 0; mask < 2 ** options.length; mask++) {
        const selected = options.filter((_, bit) => mask & (1 << bit));
        await check(
          (tip ? 'with-tip' : 'no-tip') + '/' + (selected.map(([id]) => id).join('+') || 'species-only'),
          async () => {
            const sent = [];
            window.Device.shareCatch = (...args) => {
              sent.push(args);
              return true;
            };
            await shareCard({ view, nav: {}, pack });
            assert.equal(by('card-text').textContent, entry.speciesName);
            for (const [name] of selected) by('share-' + name).checked = true;
            by('share-tip-text').value = tip;
            by('share-tip-text').dispatchEvent(new Event('input'));
            assert.equal(view.dirty, Boolean(tip));
            const expected = [
              entry.speciesName,
              tip,
              ...selected.map(([, key, value]) => words(key) + ' · ' + value),
            ]
              .filter(Boolean)
              .join('\n');
            assert.equal(by('card-text').textContent, expected);
            assert.equal(by('card-send').disabled, false);
            by('card-send').click();
            assert.deepEqual(sent, [[expected, '']]);
            assert.equal(view.dirty, false);
          },
        );
      }
    for (const source of ['unknown-trip', 'unknown-catch', 'other-trip', 'left-screen']) {
      await check('invalid-source/' + source, async () => {
        const marker = 'Existing screen',
          backs = [];
        by('screen').textContent = marker;
        if (source === 'other-trip') await Journal.saveTrip({ id: 'share-second' });
        const route = {
          tripId: source === 'unknown-trip' ? 'missing' : source === 'other-trip' ? 'share-second' : trip.id,
          catchId: source === 'unknown-catch' ? 'missing' : entry.id,
        };
        await shareCard({
          view: { route, active: () => source !== 'left-screen' },
          nav: { back: () => backs.push(true) },
          pack,
        });
        assert.equal(backs.length, Number(source !== 'left-screen'));
        assert.equal(by('screen').textContent, marker);
      });
    }
  } finally {
    window.Device.shareCatch = original;
    await Journal.removeTrip(trip.id);
    await Journal.removeTrip('share-second');
  }
}
