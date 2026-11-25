// These files are bundled with the atlas. A location lookup never needs a geocoding service.
const borders = new Map();

export function countryBorders(region) {
  if (!borders.has(region)) {
    const pending = fetch(region + '-borders.json')
      .then((response) => {
        if (!response.ok) throw Error('Missing country borders');
        return response.json();
      })
      .catch((error) => {
        borders.delete(region);
        throw error;
      });
    borders.set(region, pending);
  }
  return borders.get(region);
}

/** Even/odd ray crossing; interior rings exclude enclaves and lakes in the source polygon. */
function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) inside = !inside;
  }
  return inside;
}
export function countryAt(borders, { lon, lat }) {
  return (
    Object.keys(borders).find((code) =>
      borders[code].some(
        ([outer, ...holes]) =>
          insideRing(lon, lat, outer) && !holes.some((hole) => insideRing(lon, lat, hole)),
      ),
    ) || ''
  );
}

export async function atlasCountryAt(fix) {
  return countryAt(await countryBorders('europe'), fix) || countryAt(await countryBorders('us'), fix);
}

/** Prefer the registered network, then an unambiguous catalogue time zone, then the device locale. */
export function suggestedAtlasCountry(waters, network, timeZone, languageTag) {
  const available = new Set(waters.map((water) => water.country));
  const networkCode = (network || '').toUpperCase();
  if (available.has(networkCode)) return networkCode;
  const local = new Set(waters.filter((water) => water.zone === timeZone).map((water) => water.country));
  if (local.size === 1) return [...local][0];
  try {
    const locale = new Intl.Locale(languageTag);
    const region =
      locale.region || (locale.language && locale.language !== 'und' && locale.maximize().region);
    return available.has(region) ? region : '';
  } catch {
    return '';
  }
}
