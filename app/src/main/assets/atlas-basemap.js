const svgNS = 'http://www.w3.org/2000/svg';
const limit = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
export const maxLevel = 17;

/** Normalized Web Mercator coordinates shared by the offline overview, tiles and fishery markers. */
/** @returns {[number, number]} */
export function mercator([lon, lat]) {
  const radians = (Math.max(-limit, Math.min(limit, lat)) * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2];
}

/** Recover geographic longitude and latitude from a normalized point on the atlas. */
export function geographic([x, y]) {
  return [360 * x - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

/** Enumerate only the XYZ tiles intersecting the viewport, including fractional zoom levels. */
export function visibleTiles(camera, width, height) {
  const level = Math.max(0, Math.min(maxLevel, Math.round(camera.level)));
  const count = 2 ** level,
    world = 256 * 2 ** camera.level,
    size = world / count;
  const left = camera.x * world - width / 2,
    top = camera.y * world - height / 2;
  const tiles = [];
  for (
    let y = Math.max(0, Math.floor(top / size));
    y < Math.min(count, Math.ceil((top + height) / size));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(left / size));
      x < Math.min(count, Math.ceil((left + width) / size));
      x++
    ) {
      tiles.push({ key: level + '/' + x + '/' + y, x: x * size - left, y: y * size - top, size });
    }
  }
  return tiles;
}

/** Reuse images across pans. Wait for gestures to settle before requesting newly visible tiles. */
export function topographicLayer(group, onError) {
  const images = new Map();
  let timer;
  function status() {
    onError([...images.values()].some((image) => image.dataset.failed));
  }
  function clear() {
    clearTimeout(timer);
    images.clear();
    group.replaceChildren();
    status();
  }
  function update(camera, width, height) {
    clearTimeout(timer);
    const tiles = visibleTiles(camera, width, height);
    const visible = new Set(tiles.map((tile) => tile.key));
    for (const [key, image] of images) {
      if (!visible.has(key)) {
        image.remove();
        images.delete(key);
      }
    }
    function position(image, tile) {
      image.setAttribute('x', tile.x);
      image.setAttribute('y', tile.y);
      image.setAttribute('width', tile.size + 0.25);
      image.setAttribute('height', tile.size + 0.25);
    }
    for (const tile of tiles) {
      if (images.has(tile.key)) position(images.get(tile.key), tile);
    }
    status();
    timer = setTimeout(() => {
      for (const tile of tiles) {
        if (images.has(tile.key)) continue;
        const image = document.createElementNS(svgNS, 'image');
        images.set(tile.key, image);
        position(image, tile);
        image.addEventListener('error', () => {
          if (images.get(tile.key) !== image) return;
          image.dataset.failed = 'true';
          image.setAttribute('visibility', 'hidden');
          status();
        });
        image.setAttribute('href', 'https://tile.openmaps.fr/opentopomap/' + tile.key + '.png');
        group.append(image);
      }
    }, 120);
  }
  return { update, clear };
}
