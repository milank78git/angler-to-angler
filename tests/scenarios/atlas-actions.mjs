import assert from 'node:assert/strict';
import { atlasCountryAt } from '../../app/src/main/assets/country-lookup.js';
import { attachAtlasMap, waterFeature } from '../../app/src/main/assets/atlas-map.js';
import { geographic, mercator } from '../../app/src/main/assets/atlas-basemap.js';
import { areaImagery } from '../../app/src/main/assets/water-photo.js';
import { loadWaterShapes } from '../../app/src/main/assets/water-directory.js';
import { parkingEditor } from '../../app/src/main/assets/parking-editor.js';
import { rulesScreen } from '../../app/src/main/assets/seasons.js';
import { waterFishRules } from '../../app/src/main/assets/water-fish-rules.js';

const by = (id) => document.getElementById(id);
const sites = [
  ['prague', 14.42, 50.08, 'CZ'],
  ['berlin', 13.4, 52.52, 'DE'],
  ['denver', -104.99, 39.74, 'US'],
  ['atlantic', -29, 33, ''],
  ['pacific', -150, 0, ''],
];
export async function run({ check, words, json }) {
  for (const [city, lon, lat, country] of sites) {
    await check('offline-position/' + city, async () => {
      assert.equal(await atlasCountryAt({ lon, lat }), country);
      const [x, y] = geographic(mercator([lon, lat]));
      assert.ok(Math.abs(x - lon) < 1e-8 && Math.abs(y - lat) < 1e-8);
      const image = areaImagery(country, [lon, lat]);
      const url = new URL(image.src);
      assert.equal(url.hostname, country === 'CZ' ? 'ags.cuzk.gov.cz' : 'tiles.maps.eox.at');
      assert.equal(image.label, words(country === 'CZ' ? 'water_photo.aerial' : 'water_photo.satellite'));
      const [left, bottom, right, top] = url.searchParams.get('bbox').split(',').map(Number);
      assert.ok(right > left && top > bottom);
      assert.ok(Math.abs((right - left) / (top - bottom) - 640 / 360) < 0.01);
    });
  }
  // A known point opens coordinates; a missing point falls back to the qualified water name.
  const host = by('screen');
  const pack = json('catalog.json');
  for (const source of ['boundary', 'access', 'missing'])
    for (const active of [true, false]) {
      await check('directions/' + source + '/' + active, async () => {
        const calls = [];
        window.Device.navigate = (...v) => calls.push(v);
        window.Device.findWater = (q) => calls.push([q]);
        const water = {
          id: '401009',
          key: 'CZ:401009',
          name: 'Water',
          country: 'CZ',
          area: 'Area',
          mapped: source === 'boundary',
          ...(source === 'access' ? { access: { pt: [14.3, 49.5] } } : {}),
        };
        const directory = { geography: loadWaterShapes, waters: [water] };
        host.textContent = 'Previous screen';
        const feature = await waterFeature(water, directory);
        if (source === 'boundary') assert.ok(feature.polygons.length);
        if (source === 'missing') assert.equal(feature, null);
        await attachAtlasMap(host, water, directory, { active: () => active }, Promise.resolve(feature));
        if (!active) {
          assert.equal(host.textContent, 'Previous screen');
          return;
        }
        by('atlas-map-open').click();
        assert.deepEqual(calls, [source === 'missing' ? ['Water, Area, CZ'] : [...feature.target].reverse()]);
        assert.ok(host.textContent.includes(words(feature ? 'atlas_map.open' : 'atlas_map.search')));
      });
    }
  // Use the real keyboard picker and native map handoff. Resize observation is supplied by Android WebView.
  const observed = globalThis.ResizeObserver,
    cancel = globalThis.cancelAnimationFrame;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    for (const operation of ['add', 'edit'])
      for (const outcome of ['cancel', 'ok', 'stale', 'wrong-receipt']) {
        await check('parking/' + operation + '/' + outcome, async () => {
          const water = {
            id: 'park-water',
            key: 'CZ:park-water',
            name: 'Park water',
            country: 'CZ',
            points: [[14, 50]],
          };
          const existing = { id: 'point1', name: 'Old title', point: [14, 50], canEdit: true, revision: 4 };
          const view = {
            route: { id: water.id, parking: operation === 'edit' ? existing : null },
            active: () => true,
          };
          const calls = [],
            backs = [],
            directions = [];
          window.Device.navigate = (...args) => directions.push(args);
          window.Device.profileRequest = (id, op, raw) => {
            assert.equal(op, 'parking_save');
            const args = JSON.parse(raw);
            calls.push(args);
            window.profileReply(id, outcome === 'stale' ? 409 : 200, {
              id: outcome === 'wrong-receipt' ? 'mismatched' : args.point_id,
            });
          };
          await parkingEditor({
            view,
            nav: { back: () => backs.push(true) },
            waterDirectory: { byId: new Map([[water.id, water]]) },
          });
          try {
            assert.equal(by('parking-confirm').disabled, operation === 'add');
            if (operation === 'add')
              by('world-map').dispatchEvent(
                new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
              );
            assert.equal(by('parking-confirm').disabled, false);
            by('parking-geo').click();
            assert.deepEqual(directions, [[50, 14]]);
            by('parking-name').value = operation === 'edit' ? 'Renamed' : '';
            by('parking-name').dispatchEvent(new Event('input'));
            const pending = by('parking-confirm').onclick();
            by(outcome === 'cancel' ? 'confirmation-cancel' : 'confirmation-accept').click();
            await pending;
            assert.equal(calls.length, Number(outcome !== 'cancel'));
            assert.equal(backs.length, Number(outcome === 'ok'));
            assert.equal(view.dirty, outcome !== 'ok');
            if (calls.length) {
              assert.ok(calls[0].point_id);
              if (operation === 'edit') assert.equal(calls[0].point_id, 'point1');
              assert.deepEqual(calls[0], {
                water_key: water.key,
                point_id: calls[0].point_id,
                expected_revision: operation === 'edit' ? 4 : 0,
                lat: 50,
                lon: 14,
                title: operation === 'edit' ? 'Renamed' : null,
              });
            }
            if (outcome === 'stale') assert.equal(by('parking-error').textContent, words('parking.conflict'));
            if (outcome === 'wrong-receipt') assert.ok(by('parking-error').textContent);
          } finally {
            view.dispose();
          }
        });
      }
  } finally {
    globalThis.ResizeObserver = observed;
    globalThis.cancelAnimationFrame = cancel;
  }
  // A fixed water keeps its identity when a reader changes the species or follows the atlas link.
  for (const trout of [true, false, undefined]) {
    await check('water-rules/' + (trout ?? 'unknown'), async () => {
      const site = {
        id: 'field-water',
        key: 'CZ:field-water',
        country: 'CZ',
        name: 'Fixture',
        zone: 'Europe/Prague',
        trout,
      };
      const opened = [],
        nav = { open: (...args) => opened.push(args) };
      const view = { route: { page: 'waterRules', id: site.id, day: '2028-02-29' }, active: () => true };
      await rulesScreen({
        view,
        nav,
        pack,
        waterDirectory: {
          waters: [site],
          byId: new Map([[site.id, site]]),
          countries: { CZ: {} },
          sources: { directories: {} },
        },
        hints: {},
      });
      assert.equal(by('rule-water').disabled, true);
      await waterFishRules(view, nav, site);
      assert.equal(Boolean(by('lookup-class')), trout === undefined);
      const choice = by('lookup-species');
      choice.value = 'Esox lucius';
      choice.dispatchEvent(new Event('change'));
      assert.equal(view.route.lookupLatin, 'Esox lucius');
      by('water-fish-rules').click();
      assert.equal(opened.at(-1)[1].siteId, site.id);
      assert.equal(opened.at(-1)[1].day, '2028-02-29');
      view.dispose();
    });
  }
}
