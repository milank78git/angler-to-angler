import { insertMarkup, replaceMarkup } from './markup.js';
import { mercator } from './atlas-basemap.js';
import { Journal } from './journal.js';
import { pixelJpeg } from './photo.js';
import { button, by, esc, icon, link, t } from './ui.js';

const attributionLicense = 'https://creativecommons.org/licenses/by/4.0/';

/** Frame the published reference point, including access sites and management areas. */
export function areaImagery(country, target) {
  if (!target) return null;
  const [x, y] = mercator(target);
  const circumference = 40075016.68557849;
  const east = (x - 0.5) * circumference,
    north = (0.5 - y) * circumference;
  const czech = country === 'CZ';
  // The satellite mosaic resolves about ten metres per pixel. Frame a wider area for it.
  const radius = (czech ? 400 : 1100) / Math.cos((target[1] * Math.PI) / 180);
  const height = (radius * 360) / 640;
  const bbox = [east - radius, north - height, east + radius, north + height].map(Math.round).join(',');
  if (czech) {
    const query = new URLSearchParams({
      bbox,
      bboxSR: '3857',
      imageSR: '3857',
      size: '640,360',
      format: 'jpg',
      f: 'image',
    });
    return {
      src: 'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/export?' + query,
      label: t('water_photo.aerial'),
      source: 'https://geoportal.cuzk.gov.cz/',
      author: t('water_photo.cuzk'),
    };
  }
  const query = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: 's2cloudless_3857',
    srs: 'EPSG:3857',
    bbox,
    width: '640',
    height: '360',
    format: 'image/jpeg',
    styles: '',
  });
  return {
    src: 'https://tiles.maps.eox.at/wms?' + query,
    label: t('water_photo.satellite'),
    source: 'https://cloudless.eox.at/',
    author: 'EOxCloudless by EOX IT Services GmbH · ' + t('water_photo.copernicus'),
  };
}

/** The catalogue picture and the angler's override are both attached to a stable, qualified water key. */
export async function attachWaterPhoto(host, site, bundled, feature, view) {
  let objectUrl, area, own, currentImage;
  const dispose = view.dispose;
  view.dispose = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dispose();
  };
  replaceMarkup(
    host,
    '<figure class="water-photo detail-hero" hidden><figcaption class="credits"></figcaption></figure>' +
      '<p class="meta" role="status"></p><div class="photo-field"><input type="file" id="water-photo-file" accept="image/*" disabled>' +
      '<label for="water-photo-file">' +
      icon('image') +
      '<span></span></label></div>' +
      button('water-photo-remove', t('water_photo.remove'), 'secondary'),
  );
  const figure = host.querySelector('figure'),
    caption = figure.querySelector('figcaption');
  const status = host.querySelector('[role=status]'),
    input = by('water-photo-file');
  const label = input.labels[0].querySelector('span'),
    remove = by('water-photo-remove');
  remove.hidden = true;
  label.textContent = t('water_photo.add');

  /** Replace the current water preview with the available local or packaged image. */
  function display(blob) {
    own = blob;
    currentImage?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = own ? URL.createObjectURL(own) : null;
    remove.hidden = !own;
    label.textContent = own ? t('water_photo.replace') : t('water_photo.add');
    const src = objectUrl || bundled?.asset || area?.src;
    figure.hidden = !src;
    status.textContent = src ? '' : t('water_photo.missing');
    if (!src) return;
    const kind = own ? t('water_photo.personal') : bundled ? t('water_photo.shore') : area.label;
    replaceMarkup(
      caption,
      own
        ? esc(kind)
        : esc(kind) +
            ' · ' +
            (bundled
              ? link(bundled.source, bundled.author) +
                ' · ' +
                link(bundled.licenseUrl, bundled.license) +
                ' · ' +
                esc(t('waters.resized_and_cropped'))
              : link(area.source, area.author) + ' · ' + link(attributionLicense, 'CC BY 4.0')),
    );
    const image = new Image();
    currentImage = image;
    image.alt = kind + ' · ' + site.name;
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => {
      if (!view.active() || currentImage !== image) return;
      figure.hidden = true;
      status.textContent = t('water_photo.unavailable');
      if (!own && !bundled && area) {
        insertMarkup(status, 'beforeend', ' ' + button('water-photo-retry', t('common.retry'), 'secondary'));
        by('water-photo-retry').onclick = () => display(null);
      }
    };
    figure.prepend(image);
    image.src = src;
  }

  // A bundled or personal photo needs no network, including when the atlas is in offline mode.
  const [stored, mapped] = await Promise.all([
    Journal.waterPhoto(site.key).catch(() => null),
    !bundled && localStorage.getItem('atlas.topographic') !== 'off' ? feature : null,
  ]);
  if (!view.active()) return;
  area = areaImagery(site.country, mapped?.target);
  display(stored);
  input.disabled = false;
  /** Persist the chosen water image and refresh its preview after the write. */
  async function save(file) {
    if (input.disabled) return;
    input.disabled = remove.disabled = true;
    try {
      const blob = file ? await pixelJpeg(file, 1280) : null;
      await Journal.setWaterPhoto(site.key, blob);
      if (view.active()) display(blob);
    } catch {
      if (view.active()) status.textContent = t('water_photo.save_failed');
    } finally {
      if (view.active()) {
        input.disabled = remove.disabled = false;
        input.value = '';
      }
    }
  }
  input.onchange = () => {
    if (input.files[0]) save(input.files[0]);
  };
  remove.onclick = () => save(null);
}
