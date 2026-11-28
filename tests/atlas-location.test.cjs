const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { setImmediate: yieldTurn } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

test('explicit atlas location updates both the list and the map without replaying old fixes', async (t) => {
  const assets = path.join(__dirname, '../app/src/main/assets');
  const json = (name) => JSON.parse(readFileSync(path.join(assets, name), 'utf8'));
  const { window } = new JSDOM(readFileSync(path.join(assets, 'index.html'), 'utf8'), {
    url: 'https://atlas.test/',
  });
  const requests = [],
    cancelled = [];
  const device = {
    localeTag: () => 'en',
    subjectId: () => 'atlas-location-owner',
    networkCountry: () => 'CZ',
    atlasLocation: (id) => requests.push(id),
    cancelLocation: (id) => cancelled.push(id),
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    Element: window.Element,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    localStorage: window.localStorage,
    Device: device,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    fetch: async (name) => ({ ok: true, json: async () => json(name) }),
    matchMedia: () => ({ matches: false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (fn) => {
      fn();
      return 0;
    },
    cancelAnimationFrame: () => {},
  });
  window.Device = device;
  localStorage.setItem('atlas.topographic', 'off');
  localStorage.setItem('atlas.country.atlas-location-owner', '');
  localStorage.setItem('atlas.location-choice.atlas-location-owner', '1');
  const { loadDictionary, label } = await import('../app/src/main/assets/i18n.js');
  await loadDictionary();
  const { listWaters } = await import('../app/src/main/assets/waters.js');
  const { geographic } = await import('../app/src/main/assets/atlas-basemap.js');
  const by = (id) => document.getElementById(id);
  const prague = { lon: 14.42, lat: 50.08, accuracy: 8, time: 1000 };
  const lipno = { lon: 14.16, lat: 48.66, accuracy: 12, time: 2000 };
  const waters = [
    { id: 'denver', key: 'US:denver', country: 'US', name: 'A distant water', points: [[-104.99, 39.74]] },
    { id: 'lipno', key: 'CZ:lipno', country: 'CZ', name: 'Lipno water', points: [[lipno.lon, lipno.lat]] },
    {
      id: 'prague',
      key: 'CZ:prague',
      country: 'CZ',
      name: 'Prague water',
      points: [[prague.lon, prague.lat]],
    },
    { id: 'berlin', key: 'DE:berlin', country: 'DE', name: 'Berlin water', points: [[13.4, 52.52]] },
  ];
  let current;
  /** Flush native-event callbacks and the map's asynchronous geography update. */
  async function settle() {
    for (let index = 0; index < 4; index++) await yieldTurn();
  }
  /** Wait for the visible location action to finish without assuming a particular camera implementation. */
  async function completed() {
    for (let index = 0; index < 100 && by('nearby').disabled; index++) await yieldTurn();
    assert.equal(by('nearby').disabled, false, 'The location action did not finish');
    await settle();
  }
  /** Mount the production water list and retain its route exactly as navigation does. */
  async function mount(route = {}, geography = async () => ({})) {
    current?.dispose();
    let active = true;
    const view = { route: { page: 'waters', country: '', mapOpen: true, ...route }, active: () => active };
    const directory = {
      waters,
      byId: new Map(waters.map((water) => [water.id, water])),
      byKey: new Map(waters.map((water) => [water.key, water])),
      geography,
      countries: { CZ: {}, DE: {}, US: {} },
      sources: { providers: {}, directories: {} },
    };
    await listWaters({
      view,
      pack: { id: 'atlas-fixture' },
      nav: { open() {}, show() {} },
      waterDirectory: directory,
    });
    const dispose = view.dispose;
    view.dispose = () => {
      active = false;
      dispose();
    };
    current = view;
    await settle();
    return view;
  }
  /** Begin a genuine native request through one of the atlas controls. */
  function request(button = 'nearby') {
    const count = requests.length;
    by(button).click();
    assert.equal(requests.length, count + 1);
    assert.equal(by('nearby').disabled, true);
    return requests.at(-1);
  }
  /** Deliver the same event the Android bridge sends to the active WebView. */
  function deliver(id, fix) {
    window.dispatchEvent(new CustomEvent('angler-position', { detail: { id, fix } }));
  }
  /** Accept a normal GPS reply and wait until both result surfaces are ready. */
  async function locate(fix, button) {
    deliver(request(button), fix);
    await completed();
  }
  /** Assert geographic center and useful local scale instead of private route bookkeeping. */
  function centered(view, fix, minimumZoom = 11) {
    assert.ok(view.route.camera, 'A map camera must exist');
    const [lon, lat] = geographic([view.route.camera.x, view.route.camera.y]);
    assert.ok(Math.abs(lon - fix.lon) < 1e-7, 'Expected longitude ' + fix.lon + ', got ' + lon);
    assert.ok(Math.abs(lat - fix.lat) < 1e-7, 'Expected latitude ' + fix.lat + ', got ' + lat);
    assert.ok(
      view.route.camera.level >= minimumZoom && view.route.camera.level <= 17,
      'Expected a useful local GPS zoom',
    );
    assert.ok(by('world-map').getAttribute('viewBox'), 'The actual SVG must have redrawn');
  }
  /** Pan through the real keyboard interaction and return the changed camera. */
  function pan() {
    by('world-map').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { ...current.route.camera };
  }
  t.after(() => {
    current?.dispose();
    window.close();
  });

  await t.test('a map already on screen centers and zooms after a nearby-location reply', async () => {
    const view = await mount();
    assert.ok(view.route.camera.level < 11);
    await locate(prague);
    centered(view, prague);
    assert.ok(by('map-markers').querySelector('[aria-label="Prague water"]'));
    assert.equal(by('map-markers').querySelector('[aria-label="A distant water"]'), null);
    const position = by('map-markers').querySelector('.atlas-position');
    assert.equal(position.getAttribute('aria-label'), label('common.angler_position'));
    assert.equal(position.getAttribute('role'), 'img');
  });

  await t.test('country detection applies the GPS view after changing the country filter', async () => {
    const view = await mount({ country: 'DE' });
    await locate(prague, 'atlas-locate-country');
    assert.equal(view.route.country, 'CZ');
    assert.equal(by('water-country').value, 'CZ');
    centered(view, prague);
    assert.equal(by('waters').querySelector('[data-water]').dataset.water, 'prague');
  });

  await t.test(
    'a location obtained in list mode sorts nearby waters and centers the first map opening',
    async () => {
      const view = await mount({ mapOpen: false });
      assert.equal(by('waters').querySelector('[data-water]').dataset.water, 'denver');
      await locate(prague);
      assert.equal(by('waters').querySelector('[data-water]').dataset.water, 'prague');
      assert.ok(view.route.distances.get('prague') < view.route.distances.get('lipno'));
      assert.equal(view.route.mapOpen, false);
      by('map-toggle').click();
      await settle();
      centered(view, prague);
    },
  );

  await t.test(
    'a newer fix obtained while a previous map is hidden replaces its old camera once',
    async () => {
      const view = await mount();
      await locate(prague);
      pan();
      by('map-toggle').click();
      await locate(lipno);
      assert.equal(by('waters').querySelector('[data-water]').dataset.water, 'lipno');
      by('map-toggle').click();
      await settle();
      centered(view, lipno);
      const moved = pan();
      by('map-toggle').click();
      by('map-toggle').click();
      await settle();
      assert.deepEqual(view.route.camera, moved, 'Showing the map again must not replay an already used fix');
    },
  );

  await t.test('another explicit request recenters even when GPS returns identical coordinates', async () => {
    const view = await mount();
    await locate(prague);
    const initial = { ...view.route.camera };
    assert.notDeepEqual(pan(), initial);
    await locate(prague);
    centered(view, prague);
    assert.equal(view.route.camera.level, initial.level);
  });

  await t.test('manual pan and zoom survive an unchanged-query redraw after GPS is consumed', async () => {
    const view = await mount();
    await locate(prague);
    pan();
    by('zoom-in').click();
    const manual = { ...view.route.camera };
    by('search').dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    assert.deepEqual(view.route.camera, manual);
    assert.equal(by('map-online').checked, false, 'Location must not enable online map tiles');
    assert.equal(by('map-tiles').childElementCount, 0);
  });

  await t.test(
    'a broad location uncertainty keeps the fix centered without pretending to street-level accuracy',
    async () => {
      const view = await mount();
      await locate(prague);
      const preciseZoom = view.route.camera.level;
      await locate({ ...prague, accuracy: 50000 });
      centered(view, prague, 0);
      assert.ok(view.route.camera.level < preciseZoom, 'A 50 km uncertainty must fit a broader camera view');
      const radius = Number(by('map-markers').querySelector('.atlas-position-accuracy').getAttribute('r'));
      assert.ok(radius > 6 && radius < 150, 'The reported uncertainty must be drawn inside the map viewport');
    },
  );

  await t.test('the explicit fit action can return to all matching waters after a GPS focus', async () => {
    const view = await mount();
    const overview = { ...view.route.camera };
    await locate(prague);
    by('map-fit').click();
    assert.deepEqual(view.route.camera, overview);
    by('search').dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    assert.deepEqual(view.route.camera, overview, 'A consumed GPS fix must not override a later fit action');
  });

  await t.test(
    'a country selected after GPS in list mode takes precedence when opening the map',
    async () => {
      const view = await mount({ mapOpen: false });
      await locate(prague);
      by('water-country').value = 'DE';
      by('water-country').dispatchEvent(new Event('change', { bubbles: true }));
      by('map-toggle').click();
      await settle();
      centered(view, { lon: 13.4, lat: 52.52 });
      assert.equal(view.route.country, 'DE');
    },
  );

  await t.test(
    'empty search results still show the requested geographic area without clearing the search',
    async () => {
      const view = await mount({ query: 'no matching water anywhere' });
      await locate(prague);
      centered(view, prague);
      assert.equal(by('search').value, 'no matching water anywhere');
      assert.equal(by('waters').querySelector('[data-water]'), null);
      assert.equal(by('map-markers').querySelector('[data-group]'), null);
    },
  );

  await t.test(
    'an unknown country does not discard a valid geographic fix or replace the selected country',
    async () => {
      const view = await mount({ country: 'CZ' });
      const ocean = { lon: -29, lat: 33, accuracy: 10 };
      await locate(ocean, 'atlas-locate-country');
      centered(view, ocean);
      assert.equal(view.route.country, 'CZ');
      assert.equal(by('water-country').value, 'CZ');
      assert.equal(
        by('nearby-status').textContent,
        label('fish_catalogue.country_unavailable_choose_it_from_the_list'),
      );
    },
  );

  await t.test(
    'unavailable water outlines do not prevent focusing a valid fix or sorting known water points',
    async () => {
      const view = await mount({}, async () => {
        throw Error('Offline outline edition unavailable');
      });
      await locate(prague);
      centered(view, prague);
      assert.equal(by('waters').querySelector('[data-water]').dataset.water, 'prague');
      assert.equal(view.route.distances.get('prague'), 0);
    },
  );

  await t.test(
    'failed and malformed location replies retain the previous camera and permit retry',
    async () => {
      const view = await mount();
      await locate(prague);
      const previous = { ...view.route.camera };
      for (const fix of [
        null,
        { lat: NaN, lon: 14 },
        { lat: 50, lon: Infinity },
        { lat: 91, lon: 14 },
        { lat: 50, lon: 181 },
      ]) {
        await locate(fix);
        assert.deepEqual(view.route.camera, previous);
        assert.equal(by('nearby-status').textContent, label('atlas.location_failed'));
        assert.equal(by('atlas-locate-country').disabled, false);
      }
      await locate(lipno);
      centered(view, lipno);
    },
  );

  await t.test(
    'a cancelled request cannot override a country chosen manually while GPS was pending',
    async () => {
      const view = await mount();
      const id = request('atlas-locate-country');
      by('water-country').value = 'DE';
      by('water-country').dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      const manual = { ...view.route.camera };
      assert.ok(cancelled.includes(id));
      deliver(id, prague);
      await settle();
      assert.deepEqual(view.route.camera, manual);
      assert.equal(view.route.country, 'DE');
      assert.equal(by('nearby').disabled, false);
    },
  );

  await t.test('late replies from a retired view cannot consume the active view request', async () => {
    const previous = await mount();
    const oldId = request();
    previous.dispose();
    const view = await mount();
    const activeId = request();
    const initial = { ...view.route.camera };
    deliver(oldId, prague);
    await settle();
    assert.equal(by('nearby').disabled, true);
    assert.deepEqual(view.route.camera, initial);
    deliver(activeId, lipno);
    await completed();
    centered(view, lipno);
  });

  await t.test(
    'a late geography result cannot reapply GPS after the user selects another country',
    async () => {
      let reads = 0,
        release;
      const view = await mount({}, () => {
        reads++;
        return reads === 1
          ? Promise.resolve({})
          : new Promise((resolve) => {
              release = resolve;
            });
      });
      const id = request();
      deliver(id, prague);
      await settle();
      assert.equal(typeof release, 'function');
      by('water-country').value = 'DE';
      by('water-country').dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      const manual = { ...view.route.camera };
      release({});
      await settle();
      assert.deepEqual(view.route.camera, manual);
      assert.equal(view.route.country, 'DE');
      assert.equal(by('nearby').disabled, false);
    },
  );

  await t.test(
    'the accepted device coordinates remain in route memory and do not enter persistent preferences',
    async () => {
      const view = await mount();
      const snapshot = () =>
        Object.fromEntries(
          Object.keys(localStorage)
            .sort()
            .map((key) => [key, localStorage.getItem(key)]),
        );
      const prior = snapshot();
      await locate(prague);
      centered(view, prague);
      assert.deepEqual(snapshot(), prior);
    },
  );
});
