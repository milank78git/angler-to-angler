import { replaceMarkup } from './markup.js';
import { countryBorders } from './country-lookup.js';
import { by, esc, t, toast } from './ui.js';

/** Accept only a longitude and latitude pair inside geographic bounds. */
const valid = (p) =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every(Number.isFinite) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;

/** Use a published coordinate on the water. A polygon centre can lie on land or in a hole. */
export function mapFeature(water, outlines) {
  const polygons = (outlines || [])
    .map((p) => p.map((r) => r.filter(valid)).filter((r) => r.length >= 3))
    .filter((p) => p.length);
  const lines = (water.lines || []).map((l) => l.filter(valid)).filter((l) => l.length >= 2);
  const points = (water.points || water.bounds || []).filter(valid);
  const access = valid(water.access?.pt) ? water.access.pt : null;
  const target = access || points[0] || lines[0]?.[0] || polygons[0]?.[0]?.[0];
  return target ? { target, access, polygons, lines, points } : null;
}

/** Fit published coordinates into the drawing area while reserving space for labels. */
function projection(points, width, height, padding) {
  const cos = Math.max(0.02, Math.cos((points[0][1] * Math.PI) / 180));
  let left = Infinity,
    right = -Infinity,
    bottom = Infinity,
    top = -Infinity;
  for (const [lon, lat] of points) {
    left = Math.min(left, lon * cos);
    right = Math.max(right, lon * cos);
    bottom = Math.min(bottom, lat);
    top = Math.max(top, lat);
  }
  const scale = Math.min(
    (width - 2 * padding) / Math.max(0.003, right - left),
    (height - 2 * padding) / Math.max(0.003, top - bottom),
  );
  return ([lon, lat]) => [
    (width / 2 + (lon * cos - (left + right) / 2) * scale).toFixed(1),
    (height / 2 - (lat - (top + bottom) / 2) * scale).toFixed(1),
  ];
}

/** Project each point of a line into an SVG move and line sequence. */
const path = (line, xy) => 'M' + line.map((p) => xy(p).join(' ')).join('L');
/** Load the available locator boundaries for this water's country. */
async function countryOutline(country) {
  if (country === 'US') return [];
  const borders = await countryBorders('europe').catch(() => ({}));
  return (borders[country] || []).filter((p) => p.length && p[0].length);
}

/** Draw the published extent or points offline, plus a regional locator for isolated points. */
function sketch(feature, country, neighbours) {
  const { points, lines, polygons, target } = feature;
  const xy = projection(
    [target, ...points, ...lines.flat(), ...polygons.flat(2), ...neighbours.map((n) => n.point)],
    320,
    142,
    20,
  );
  /** Close each projected boundary separately so polygon holes are retained. */
  const rings = (polygon, project) => polygon.map((ring) => path(ring, project) + 'Z').join('');
  const [x, y] = xy(target);
  const labelled = [];
  const surroundings = neighbours
    .map(({ point, name }) => {
      const [px, py] = xy(point).map(Number);
      const text = name.length > 18 ? name.slice(0, 17) + '…' : name;
      const anchor = px > 150 ? 'end' : 'start';
      const labelX = px + (anchor === 'end' ? -5 : 5);
      const labelY = py < 22 ? py + 15 : py - 6;
      const left = anchor === 'end' ? labelX - text.length * 6 : labelX;
      const right = left + text.length * 6;
      const clipped = left < 0 || right > 320 || (country.length && right > 234 && labelY > 72);
      const overlaps = labelled.some(
        (box) => left < box.right && right > box.left && Math.abs(labelY - box.y) < 14,
      );
      let label = '';
      if (!clipped && !overlaps) {
        labelled.push({ left, right, y: labelY });
        label = `<text x="${labelX}" y="${labelY}" text-anchor="${anchor}" font-size="10" fill="#334b43">${esc(text)}</text>`;
      }
      return `<circle cx="${px}" cy="${py}" r="3" fill="#49848a"/>${label}`;
    })
    .join('');
  let inset = '';
  if (country.length) {
    const project = projection([target, ...country.flat(2)], 82, 66, 5);
    const [cx, cy] = project(target);
    inset = `<g transform="translate(235 72)"><rect width="82" height="66" rx="5" fill="#f9fbfa"/>
      ${country.map((poly) => '<path fill="#c3d2c6" fill-rule="evenodd" d="' + rings(poly, project) + '"/>').join('')}
      <circle cx="${cx}" cy="${cy}" r="3" fill="#903d20"/></g>`;
  }
  return `<svg viewBox="0 0 320 142" aria-hidden="true"><rect width="320" height="142" fill="#e8f0e6"/>
    ${polygons.map((poly) => '<path fill="#8ac6cf" stroke="#337285" fill-rule="evenodd" d="' + rings(poly, xy) + '"/>').join('')}
    ${surroundings}
    ${lines.map((line) => '<path fill="none" stroke="#337285" stroke-width="3" d="' + path(line, xy) + '"/>').join('')}
    ${points
      .map((p) => {
        const [a, b] = xy(p);
        return `<circle cx="${a}" cy="${b}" r="3" fill="#33668c"/>`;
      })
      .join('')}
    <circle cx="${x}" cy="${y}" r="6" fill="#a34a25" stroke="white" stroke-width="2"/>
    <text x="293" y="17" fill="#294237" font-size="13">↑ N</text>${inset}</svg>`;
}

/** Give a point-only record local context from the same offline edition, without inventing a shoreline. */
function nearbyLabels(water, directory, target) {
  const cos = Math.cos((target[1] * Math.PI) / 180);
  const nearby = [];
  for (const other of directory.waters) {
    if (other.key === water.key) continue;
    const point = other.access?.pt || other.points?.[0] || other.bounds?.[0] || other.lines?.[0]?.[0];
    if (!valid(point)) continue;
    const km = 111.2 * Math.hypot((point[0] - target[0]) * cos, point[1] - target[1]);
    if (km > 0.1 && km < 20) nearby.push({ point, name: other.name, km });
  }
  return nearby.sort((a, b) => a.km - b.km).slice(0, 4);
}

/** Resolve the geometry available for this record from the current atlas edition. */
export async function waterFeature(water, directory) {
  const outlines = water.mapped ? await directory.geography().catch(() => ({})) : {};
  return mapFeature(water, outlines[water.key]);
}

/** Attach the offline sketch only if the requesting water screen is still mounted. */
export async function attachAtlasMap(host, water, directory, view, featurePromise) {
  const feature = await featurePromise;
  const country =
    !feature || (!feature.lines.length && !feature.polygons.length)
      ? await countryOutline(water.country)
      : [];
  if (!view.active()) return;
  const action = feature ? t('atlas_map.open') : t('atlas_map.search');
  let preview = '';
  if (feature) {
    const isolated = !feature.lines.length && !feature.polygons.length && feature.points.length < 2;
    preview = sketch(feature, country, isolated ? nearbyLabels(water, directory, feature.target) : []);
  } else if (country.length) {
    const xy = projection(country.flat(2), 320, 142, 9);
    const land = country.map((poly) => poly.map((ring) => path(ring, xy) + 'Z').join('')).join('');
    preview =
      '<svg viewBox="0 0 320 142" aria-hidden="true"><path fill="#c3d2c6" fill-rule="evenodd" d="' +
      land +
      '"/></svg>';
  }
  replaceMarkup(
    host,
    '<h2>' +
      t('waters.water_map') +
      '</h2>' +
      '<button type="button" id="atlas-map-open" class="map-open">' +
      preview +
      '<span>' +
      esc(action) +
      '</span></button><p class="meta">' +
      (feature
        ? esc(feature.access ? t('atlas_map.access') : t('atlas_map.reference')) +
          ' · ' +
          esc(
            feature.target
              .slice()
              .reverse()
              .map((v) => v.toFixed(5))
              .join(', '),
          )
        : t('atlas_map.no_position')) +
      '</p>',
  );
  by('atlas-map-open').onclick = () => {
    if (!window.Device) return toast(t('waters.directions_are_available_on_android'));
    if (feature) Device.navigate(feature.target[1], feature.target[0]);
    else Device.findWater([water.name, water.area, water.country].filter(Boolean).join(', '));
  };
}
