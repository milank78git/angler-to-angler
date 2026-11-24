const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../app/src/main/assets/domain');
const pack = require('../app/src/main/assets/catalog.json');
const rivers = require('../app/src/main/assets/rivers.json');

test('search handles Czech accents, spacing and case', () => {
  assert.equal(d.fold(' ' + pack.waters.find(w => w.id === '401009').name.toUpperCase().replace(' ', '  ')), d.fold('sazava1'));
  assert.equal(d.fold('401 009'), d.fold('401009'));
});
test('signed GPS input preserves the prime meridian and rejects partial or invalid coordinates', () => {
  assert.deepEqual(d.point('0', '-1,5'), { lat: 0, lon: -1.5 });
  assert.equal(d.point('', ''), null);
  assert.throws(() => d.point('2', '181'), /^Error: lon$/);
  for (const args of [
    ['', '1'],
    ['90.01', '0'],
    ['-45', '181'],
    ['abc', '2'],
    ['0', '0x10'],
  ])
    assert.throws(() => d.point(...args));
});
test('manual centimetres round to integer millimetres', () => {
  assert.equal(d.lengthMm('64,5'), 645);
  assert.equal(d.lengthMm(''), null);
  for (const v of ['0', '-2', 'x', '2600', '0.02', '0x20', '1e2', '0b10'])
    assert.throws(() => d.lengthMm(v));
});
test('regional seasons include both boundaries and wrap across New Year', () => {
  for (const [day, expected] of [
    ['2026-03-15', 'outside'],
    ['2026-03-16', 'closed'],
    ['2026-06-15', 'closed'],
    ['2026-06-16', 'outside'],
  ])
    assert.equal(d.season(pack, 'roach', 'main', day), expected);
  assert.equal(
    d.season({ ...pack, species: { x: { window: ['09-01', '04-15'] } } }, 'x', 'main', '2026-01-01'),
    'closed',
  );
});
test('unknown dates, stale packs, uncatalogued species and unsupported sections do not produce permission to fish', () => {
  for (const day of ['2026-02-30', '2027-01-01', '2025-12-31', ''])
    assert.equal(d.season(pack, 'pike', 'main', day), 'unknown');
  assert.equal(d.season(pack, 'carp', 'main', '2026-07-01'), 'unknown');
  assert.equal(d.season(pack, 'pike', 'other', '2026-07-01'), 'unknown');
  assert.equal(d.season(pack, 'pike', 'restricted', '2026-07-01'), 'prohibited');
  assert.equal(d.season(pack, 'barbel', 'main', '2026-12-31'), 'closed');
});
test('pack covers two sourced reaches with distinct size rules and real offline geometry', () => {
  const [a, b] = pack.waters;
  assert.equal(a.size.pike, 60);
  assert.equal(b.size.pike, 50);
  assert.equal(a.access, null);
  for (const w of pack.waters) {
    assert.ok(w.source.startsWith('https://'));
    const pts = rivers[w.id].flat();
    for (const [lon, lat] of w.bounds) assert.ok(pts.some(([x, y]) => Math.hypot(x - lon, y - lat) < 0.01));
  }
  assert.ok(b.access.source.startsWith('https://'));
  assert.equal(pack.zone, 'Europe/Prague');
});
