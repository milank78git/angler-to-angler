import assert from 'node:assert/strict';
import { catchForm } from '../../app/src/main/assets/catch-form.js';
import { Journal } from '../../app/src/main/assets/journal.js';

// Drive the installed submit handler through the localized form and examine the record committed to IndexedDB.
export async function run({ check, words, json }) {
  const pack = json('catalog.json'),
    trip = { id: 'trip', waterId: 'water', country: 'CZ', day: '2028-02-29' };
  await Journal.saveTrip(trip);
  const view = { active: () => true, route: { id: trip.id } };
  const written = [];
  await catchForm({
    view,
    nav: { journalAfterWrite: (id) => written.push(id) },
    pack,
    waterDirectory: { byId: new Map() },
  });
  const field = (id) => document.getElementById(id);
  const submit = () => field('form').onsubmit(new Event('submit', { cancelable: true }));
  assert.equal(document.querySelector('#screen h1').textContent, words('catch_form.new_catch'));
  const lengths = [
    ['', null],
    ['0,05', 1],
    ['64.54', 645],
    ['+64,55', 646],
    ['2500', 25000],
  ];
  const coordinates = [
    ['', '', null],
    ['0', '0', [0, 0]],
    ['-90', '-180', [-90, -180]],
    ['+90', '180', [90, 180]],
    ['-.75', '14,25', [-0.75, 14.25]],
  ];
  function choose(species) {
    field('catch-search').value = species === 'manual' ? '' : species;
    field('catch-search').dispatchEvent(new Event('input'));
    field('fish').value = species;
    field('fish').dispatchEvent(new Event('change'));
    field('fish-name').value = '  Local name  ';
  }
  try {
    for (const species of ['manual', 'Esox lucius', 'Cyprinus carpio']) {
      for (const [length, mm] of lengths)
        for (const [lat, lon, point] of coordinates) {
          for (const kind of point ? ['stand', 'strike'] : ['stand']) {
            await check(`save/${species}/${JSON.stringify([length, lat, lon, kind])}`, async () => {
              choose(species);
              field('catch-length').value = length;
              field('lat').value = lat;
              field('lon').value = lon;
              field('kind').value = kind;
              const before = written.length;
              await submit();
              assert.deepEqual(written.slice(before), [trip.id]);
              const [record] = await Journal.catches(trip.id);
              assert.equal(record.tripId, trip.id);
              assert.equal(record.lengthMm, mm);
              assert.equal(
                record.speciesId,
                species === 'manual' ? null : species === 'Esox lucius' ? 'pike' : species,
              );
              if (species === 'manual') assert.equal(record.speciesName, 'Local name');
              if (point)
                assert.deepEqual(
                  [record.position.lat, record.position.lon, record.position.kind, record.position.source],
                  [...point, kind, 'manual'],
                );
              else assert.equal(record.position, null);
              assert.equal(record.hasPhoto, false);
              await Journal.removeCatch(trip.id, record.id);
            });
          }
        }
    }
    // Include failures in more than one field to assert which error and focus the angler receives first.
    for (const [length, lat, lon, invalid] of [
      ['0', '', '', 'catch-length'],
      ['2e2', '92', '181', 'catch-length'],
      ['2500.1', '0', '0', 'catch-length'],
      ['0.049', '0', '0', 'catch-length'],
      ['1', '', '12', 'lat'],
      ['1', '-90.1', '181', 'lat'],
      ['1', '0x10', '20', 'lat'],
      ['1', '0', '', 'lon'],
      ['1', '90', '180.1', 'lon'],
      ['1', '0', 'NaN', 'lon'],
    ])
      await check(`reject/${JSON.stringify([length, lat, lon])}`, async () => {
        choose('manual');
        field('catch-length').value = length;
        field('lat').value = lat;
        field('lon').value = lon;
        const before = written.length;
        await submit();
        assert.equal(document.activeElement, field(invalid));
        assert.equal(field(invalid).getAttribute('aria-describedby'), 'form-error');
        assert.deepEqual(
          [...field('form').querySelectorAll('[aria-invalid]')].map((el) => el.id),
          [invalid],
        );
        assert.equal(field('form-error').hidden, false);
        assert.equal(
          field('form-error').textContent,
          words(
            invalid === 'catch-length'
              ? 'catch_form.enter_a_positive_length_in_centimetres'
              : 'catch_form.check_both_coordinates_latitude_90_longitude_180',
          ),
        );
        assert.equal(written.length, before);
        assert.deepEqual(await Journal.catches(trip.id), []);
      });
  } finally {
    view.dispose();
  }
}
