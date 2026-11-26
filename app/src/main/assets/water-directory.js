import { fold } from './domain.js';
import { internationalWaters } from './international-waters.js';

export function createWaterDirectory(
  pack,
  snapshot,
  editions = {},
  sources = { providers: {}, directories: {} },
  countries = {},
  shapes,
) {
  const records = new Map(snapshot.waters.map((w) => [w.id, w]));
  const waters = [];
  for (const w of pack.waters) {
    const key = pack.country + ':' + w.id;
    waters.push({ ...records.get(key), ...w, key, country: pack.country, zone: pack.zone });
    records.delete(key);
  }
  for (const row of records.values()) {
    const number = row.number.replace(/^(\d{3})(\d{3})(?=\/|$)/, '$1 $2');
    const source =
      row.provider === 'CRS' ? 'https://www.rybsvaz.cz/karta-reviru/-/' : 'https://mrsbrno.cz/reviry/';
    waters.push({
      ...row,
      number,
      key: row.id,
      country: 'CZ',
      zone: 'Europe/Prague',
      area: [...new Set([row.region, row.manager].filter(Boolean))].join(' · '),
      source: source + encodeURIComponent(row.slug),
    });
  }
  const outlines = {};
  for (const [provider, edition] of Object.entries(editions)) {
    const meta = sources.providers[provider];
    for (const { outline, ...record } of edition.waters) {
      const key = meta.country + ':' + provider + ':' + record.code;
      if (outline) outlines[key] = outline;
      waters.push({
        ...record,
        id: key,
        key,
        provider,
        country: meta.country,
        zone: meta.zone,
        source: meta.url,
        publisher: meta.label,
        licence: meta.licence,
        scope: meta.scope,
        kind: meta.kind,
        asOf: edition.asOf,
        area: record.area || meta.scope,
        number: record.number || '',
        mapped: !!outline,
      });
    }
  }
  for (const w of internationalWaters) {
    waters.push({ ...w, key: w.id, country: 'US', provider: 'FWP' });
  }
  const geography = async () => ({ ...(shapes ?? (await loadWaterShapes())), ...outlines });
  return {
    waters,
    sources,
    countries,
    geography,
    asOf: snapshot.asOf,
    byId: new Map(waters.map((w) => [w.id, w])),
    byKey: new Map(waters.map((w) => [w.key, w])),
  };
}

/** Both the atlas and its pickers accept unspaced numbers and names without diacritics. */
export function matchesWater(water, foldedQuery) {
  return (
    !foldedQuery ||
    fold(
      [water.name, water.number, water.area, water.manager, water.country, water.code]
        .filter(Boolean)
        .join(' '),
    ).includes(foldedQuery)
  );
}

/** Only reviewed pack records carry section rules, dates and size limits. */
export function localRuleWater(pack, water) {
  if (water?.country === pack.country) return pack.waters.find((local) => local.id === water.id);
}

/** Older pilot trips store a short local ID. Imported waters already have qualified IDs. */
export function tripWater(directory, trip) {
  const water = directory.byId.get(trip?.waterId);
  return water && water.country === trip.country ? water : undefined;
}

const rad = Math.PI / 180;
function km([x, y], lon, lat) {
  const h =
    Math.sin(((lat - y) * rad) / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(y * rad) * Math.sin(((lon - x) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function segmentDistance(x, y, endX, endY, lon, lat, scale) {
  const dx = (endX - x) * scale,
    dy = endY - y;
  const length2 = dx * dx + dy * dy;
  const fraction = length2
    ? Math.max(0, Math.min(1, ((lon - x) * scale * dx + (lat - y) * dy) / length2))
    : 0;
  return km([x + fraction * (endX - x), y + fraction * dy], lon, lat);
}

/** Distance to a simplified mapped surface, accounting for separate parts and interior holes. */
function outlineDistance(polygons, lon, lat) {
  const scale = Math.cos(lat * rad);
  let nearest = Infinity;
  for (const rings of polygons) {
    let onSurface = false;
    for (const ring of rings) {
      let inside = false;
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = ring[i - 1],
          [endX, endY] = ring[i];
        if (y > lat !== endY > lat && lon < x + ((endX - x) * (lat - y)) / (endY - y)) inside = !inside;
        nearest = Math.min(nearest, segmentDistance(x, y, endX, endY, lon, lat, scale));
      }
      if (inside) onSurface = !onSurface;
    }
    if (onSurface) return 0;
  }
  return nearest;
}

/** Unknown positions remain unknown. A pair of official endpoints does not imply a straight river. */
export function waterDistances(waters, shapes, { lon, lat }) {
  const distances = new Map();
  for (const w of waters) {
    let value = shapes[w.key] ? outlineDistance(shapes[w.key], lon, lat) : Infinity;
    for (const line of w.lines || []) {
      for (let i = 1; i < line.length; i++) {
        value = Math.min(value, segmentDistance(...line[i - 1], ...line[i], lon, lat, Math.cos(lat * rad)));
      }
    }
    for (const pt of [...(w.points || []), ...(w.bounds || []), ...(w.access ? [w.access.pt] : [])]) {
      value = Math.min(value, km(pt, lon, lat));
    }
    if (Number.isFinite(value)) distances.set(w.id, value);
  }
  return distances;
}

let pendingShapes;
export function loadWaterShapes() {
  pendingShapes ??= fetch('czech-water-shapes.json')
    .then((response) => {
      if (!response.ok) throw new Error('Missing water outlines');
      return response.json();
    })
    .catch((error) => {
      pendingShapes = undefined;
      throw error;
    });
  return pendingShapes;
}
