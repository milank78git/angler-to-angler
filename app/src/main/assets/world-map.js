import { replaceMarkup } from './markup.js';
import { maxLevel, mercator, geographic, topographicLayer } from './atlas-basemap.js';
import { by, button, esc, link, t } from './ui.js';

function mapPin(x, y, radius, label) {
  const ns = 'http://www.w3.org/2000/svg';
  const pin = document.createElementNS(ns, 'g');
  pin.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('r', String(radius));
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('y', '4');
  text.textContent = label;
  pin.append(circle, text);
  return pin;
}

// Use a documented point on each water; some records only have a published outline.
export function waterPoint(water, shapes) {
  return [
    water.access?.pt,
    water.points?.[0],
    water.bounds?.[0],
    water.lines?.[0]?.[0],
    shapes[water.key]?.[0]?.[0]?.[0],
  ].find(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every(Number.isFinite) &&
      Math.abs(p[0]) <= 180 &&
      Math.abs(p[1]) <= 90,
  );
}

export function clusterWaters(rows, project, width, height) {
  const cells = new Map();
  for (const row of rows) {
    const [x, y] = project(row.point);
    if (x < 0 || x > width || y < 0 || y > height) continue;
    const key = Math.floor(x / 44) + '/' + Math.floor(y / 44);
    const group = cells.get(key) || { x: 0, y: 0, waters: [] };
    group.x += x;
    group.y += y;
    group.waters.push(row);
    cells.set(key, group);
  }
  return Array.from(cells.values());
}

/** Preproject published water geometry once, so panning does not reprocess every polygon vertex. */
function waterGeometry(water, shapes) {
  const extent = [1, 1, 0, 0];
  function path(line) {
    return line
      .map((point, index) => {
        const [x, y] = mercator(point);
        extent[0] = Math.min(extent[0], x);
        extent[1] = Math.min(extent[1], y);
        extent[2] = Math.max(extent[2], x);
        extent[3] = Math.max(extent[3], y);
        return (index ? 'L' : 'M') + (x * 65536).toFixed(3) + ' ' + (y * 65536).toFixed(3);
      })
      .join('');
  }
  const polygons = (shapes[water.key] || []).flat().map((ring) => path(ring) + 'Z');
  const lines = (water.lines || []).map(path);
  return polygons.length || lines.length ? { extent, path: polygons.concat(lines).join('') } : {};
}

/** Keep camera and selection in the route so Back returns to the same area. */
export function atlasMap(host, route, openWater, picker = null) {
  replaceMarkup(
    host,
    '<div class="actions">' +
      button('zoom-in', t('atlas.zoom_in'), 'secondary') +
      button('zoom-out', t('atlas.zoom_out'), 'secondary') +
      button('map-fit', t('atlas.fit'), 'secondary') +
      '</div><label class="card-option"><input id="map-online" type="checkbox">' +
      esc(t('atlas.topographic')) +
      '</label>' +
      '<svg id="world-map" role="group" tabindex="0" aria-label="' +
      esc(t('atlas.map')) +
      '">' +
      '<image id="map-land" href="world-land.svg" aria-hidden="true"/><g id="map-tiles" aria-hidden="true"></g>' +
      '<g id="map-shapes" aria-hidden="true"></g><g id="map-markers"></g></svg>' +
      '<p id="map-attribution" class="meta">' +
      link('https://github.com/sletuffe/OpenTopoMap', '© OpenTopoMap-R') +
      ' · ' +
      link('https://www.openstreetmap.org/copyright', '© OpenStreetMap') +
      ' · ' +
      link('https://openmaps.fr/donate', t('atlas.support_maps')) +
      '</p>' +
      '<div id="map-tile-error" hidden><span role="status">' +
      esc(t('atlas.tiles_unavailable')) +
      '</span> ' +
      button('map-retry', t('common.retry'), 'secondary') +
      '</div>' +
      '<p id="map-count" role="status"></p><div id="map-selection" class="water-list"></div>',
  );
  const svg = by('world-map'),
    selected = by('map-selection'),
    markers = by('map-markers'),
    land = by('map-land');
  const online = by('map-online'),
    attribution = by('map-attribution'),
    error = by('map-tile-error'),
    shapesLayer = by('map-shapes');
  online.checked = localStorage.getItem('atlas.topographic') !== 'off';
  attribution.hidden = !online.checked;
  const tiles = topographicLayer(by('map-tiles'), (failed) => {
    error.hidden = !failed;
  });
  let rows = [],
    missing = 0,
    camera = route.camera,
    groups = [],
    index = 0,
    down,
    frame;
  const pointers = new Map(),
    visibleShapes = new Map();
  const width = () => svg.clientWidth || 320,
    height = () => svg.clientHeight || 300;
  const unit = () => 256 * 2 ** camera.level;
  function zoom(level, x = width() / 2, y = height() / 2) {
    const before = unit();
    camera.level = Math.min(maxLevel, Math.max(0, level));
    camera.x += (x - width() / 2) * (1 / before - 1 / unit());
    camera.y += (y - height() / 2) * (1 / before - 1 / unit());
    draw();
  }
  function fit() {
    if (picker?.start) {
      camera = route.camera = { ...picker.start };
      draw();
      return;
    }
    let left = 1,
      right = 0,
      top = 1,
      bottom = 0;
    for (const {
      point: [x, y],
      extent,
    } of rows) {
      left = Math.min(left, x, extent?.[0] ?? x);
      right = Math.max(right, x, extent?.[2] ?? x);
      top = Math.min(top, y, extent?.[1] ?? y);
      bottom = Math.max(bottom, y, extent?.[3] ?? y);
    }
    const scale = Math.min(width() / Math.max(1e-8, right - left), height() / Math.max(1e-8, bottom - top));
    camera = route.camera = rows.length
      ? {
          x: (right + left) / 2,
          y: (top + bottom) / 2,
          level: Math.min(14, Math.max(0, Math.log2((0.82 * scale) / 256))),
        }
      : { x: 0.5, y: 0.5, level: 0 };
    draw();
  }
  function draw() {
    if (!camera || host.hidden) return;
    camera.x = Math.min(1, Math.max(0, camera.x));
    camera.y = Math.min(1, Math.max(0, camera.y));
    const w = width(),
      h = height(),
      s = unit(),
      project = ([x, y]) => [w / 2 + (x - camera.x) * s, h / 2 + (y - camera.y) * s];
    const [x, y] = project([0, 0]);
    svg.setAttribute('viewBox', [0, 0, w, h].join(' '));
    land.setAttribute('x', String(x));
    land.setAttribute('y', String(y));
    land.setAttribute('width', String(s));
    land.setAttribute('height', String(s));
    if (online.checked) tiles.update(camera, w, h);
    // Published outlines remain available without the online topography.
    const visible = new Set(
      camera.level < 10
        ? []
        : rows.filter(
            (row) =>
              row.extent &&
              row.extent[0] <= camera.x + w / (2 * s) &&
              row.extent[2] >= camera.x - w / (2 * s) &&
              row.extent[1] <= camera.y + h / (2 * s) &&
              row.extent[3] >= camera.y - h / (2 * s),
          ),
    );
    for (const [row, element] of visibleShapes) {
      if (!visible.has(row)) {
        element.remove();
        visibleShapes.delete(row);
      }
    }
    for (const row of visible) {
      if (visibleShapes.has(row)) continue;
      const element = document.createElementNS(svg.namespaceURI, 'path');
      element.setAttribute('d', row.path);
      shapesLayer.append(element);
      visibleShapes.set(row, element);
    }
    shapesLayer.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(' + s / 65536 + ')');
    groups = clusterWaters(rows, project, w, h);
    const pins = document.createDocumentFragment();
    for (const [index, group] of groups.entries()) {
      const count = group.waters.length;
      const pin = mapPin(group.x / count, group.y / count, 17, count === 1 ? '•' : String(count));
      if (picker) pin.setAttribute('aria-hidden', 'true');
      else {
        pin.setAttribute('role', 'button');
        pin.setAttribute('tabindex', '0');
        pin.setAttribute(
          'aria-label',
          count === 1 ? group.waters[0].water.name : t('waters.waters') + ' · ' + count,
        );
        pin.dataset.group = String(index);
      }
      pins.append(pin);
    }
    if (picker?.point) {
      const [px, py] = project(mercator(picker.point));
      const pin = mapPin(px, py, 12, 'P');
      pin.classList.add('parking-pin');
      pin.setAttribute('aria-hidden', 'true');
      pins.append(pin);
    }
    markers.replaceChildren(pins);
    by('zoom-out').disabled = camera.level <= 0;
    by('zoom-in').disabled = camera.level >= maxLevel;
    by('map-count').textContent =
      t('atlas.mapped') +
      ' · ' +
      rows.length +
      ' / ' +
      (rows.length + missing) +
      (route.parkingOnly && !rows.length && !missing ? ' · ' + t('parking.filter_empty') : '');
  }
  online.onchange = () => {
    localStorage.setItem('atlas.topographic', online.checked ? 'on' : 'off');
    window.dispatchEvent(new Event('journal-edited'));
    attribution.hidden = !online.checked;
    tiles.clear();
    draw();
  };
  if (picker) by('map-count').hidden = true;
  const retry = () => {
    tiles.clear();
    draw();
  };
  by('map-retry').onclick = retry;
  window.addEventListener('online', retry);
  function pick(target) {
    const el = target.closest('[data-group]');
    if (!el) return;
    const group = groups[Number(el.dataset.group)];
    if (!group) return;
    if (group.waters.length === 1) return openWater(group.waters[0].water.id);
    // Even exactly co-located venues remain individually selectable.
    const choices = group.waters;
    index = 0;
    selected.replaceChildren();
    function more() {
      for (const { water } of choices.slice(index, index + 40)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'secondary';
        b.textContent = [water.name, water.number, water.country].filter(Boolean).join(' · ');
        b.onclick = () => openWater(water.id);
        selected.append(b);
      }
      index += 40;
      if (index < choices.length) {
        const b = document.createElement('button');
        b.textContent = t('waters.show_more_waters');
        b.onclick = () => {
          b.remove();
          more();
        };
        selected.append(b);
      }
    }
    more();
    zoom(camera.level + 1, group.x / choices.length, group.y / choices.length);
  }
  function choose(x, y) {
    if (!camera) return;
    const point = geographic([camera.x + (x - width() / 2) / unit(), camera.y + (y - height() / 2) / unit()]);
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85.051129) return;
    picker.point = point.map((n) => Number(n.toFixed(7)));
    picker.onPick(picker.point);
    draw();
  }
  svg.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (picker) choose(width() / 2, height() / 2);
      else pick(e.target);
      return;
    }
    const offset = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (offset) {
      e.preventDefault();
      camera.x += (offset[0] * 65) / unit();
      camera.y += (offset[1] * 65) / unit();
      draw();
    }
  };
  svg.onclick = (e) => {
    if (down?.moved) return;
    if (!picker) return pick(e.target);
    const rect = svg.getBoundingClientRect();
    choose(e.clientX - rect.left, e.clientY - rect.top);
  };
  svg.onpointerdown = (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    down = { x: e.clientX, y: e.clientY, moved: pointers.size > 1 };
  };
  svg.onpointermove = (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev || !down) return;
    const now = [e.clientX, e.clientY],
      other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    if (!down.moved && Math.hypot(now[0] - down.x, now[1] - down.y) < 5) return;
    down.moved = true;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, now);
    if (other) {
      const old = Math.hypot(prev[0] - other[0], prev[1] - other[1]),
        gap = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (old && gap) {
        const r = svg.getBoundingClientRect();
        camera.x -= (now[0] - prev[0]) / (2 * unit());
        camera.y -= (now[1] - prev[1]) / (2 * unit());
        zoom(
          camera.level + Math.log2(gap / old),
          (now[0] + other[0]) / 2 - r.left,
          (now[1] + other[1]) / 2 - r.top,
        );
      }
    } else {
      camera.x -= (now[0] - prev[0]) / unit();
      camera.y -= (now[1] - prev[1]) / unit();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    }
  };
  svg.onpointercancel = svg.onpointerup = (e) => pointers.delete(e.pointerId);
  svg.onpointerleave = (e) => {
    if (!svg.hasPointerCapture(e.pointerId)) pointers.delete(e.pointerId);
  };
  svg.onwheel = (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(camera.level + (e.deltaY < 0 ? 0.5 : -0.5), e.clientX - r.left, e.clientY - r.top);
  };
  by('zoom-in').onclick = () => zoom(camera.level + 1);
  by('zoom-out').onclick = () => zoom(camera.level - 1);
  by('map-fit').onclick = fit;
  const observer = new ResizeObserver(draw);
  observer.observe(svg);
  let cache = new WeakMap(),
    geometry;
  return {
    update(waters, shapes, key) {
      if (shapes !== geometry) {
        cache = new WeakMap();
        geometry = shapes;
      }
      rows = [];
      for (const water of waters) {
        if (!cache.has(water)) {
          const location = waterPoint(water, shapes);
          cache.set(
            water,
            location ? { water, point: mercator(location), ...waterGeometry(water, shapes) } : null,
          );
        }
        const row = cache.get(water);
        if (row) rows.push(row);
      }
      missing = waters.length - rows.length;
      selected.replaceChildren();
      if (!camera || route.cameraFilter !== key) fit();
      else draw();
      route.cameraFilter = key;
    },
    pause() {
      tiles.clear();
    },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      tiles.clear();
      window.removeEventListener('online', retry);
    },
  };
}
