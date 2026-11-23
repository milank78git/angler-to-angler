import { by, t, toast } from './ui.js';
import { point } from './domain.js';

let sequence = 0;

/** Own the request, accepted fix and manual edits for one mounted catch form. */
export function bindCatchPosition(view) {
  const button = by('gps'),
    latitude = by('lat'),
    longitude = by('lon');
  const label = button.querySelector('span');
  const idleLabel = label.textContent;
  let pending = 0,
    accepted = null;

  function cancel() {
    if (pending) window.Device.cancelLocation(pending);
    pending = 0;
    label.textContent = idleLabel;
  }
  function manualEdit() {
    cancel();
    accepted = null;
  }
  function receive({ detail }) {
    if (!pending || detail.id !== pending) return;
    pending = 0;
    label.textContent = idleLabel;
    if (!detail.fix) return;
    accepted = detail.fix;
    latitude.value = accepted.lat.toFixed(6);
    longitude.value = accepted.lon.toFixed(6);
    view.dirty = true;
  }

  latitude.oninput = longitude.oninput = manualEdit;
  window.addEventListener('angler-position', receive);
  button.onclick = () => {
    if (pending) return cancel();
    if (!window.Device) return toast(t('GPS je dostupná na Androidu.', 'GPS is available on Android.'));
    pending = ++sequence;
    label.textContent = t('Zrušit hledání polohy', 'Cancel location request');
    window.Device.location(pending);
  };

  return {
    waiting: () => pending !== 0,
    read() {
      const coords = point(latitude.value, longitude.value);
      return (
        coords && {
          ...coords,
          source: accepted ? 'device' : 'manual',
          accuracy: accepted?.accuracy ?? null,
          time: accepted?.time ?? Date.now(),
          kind: by('kind').value,
        }
      );
    },
    dispose() {
      window.removeEventListener('angler-position', receive);
      cancel();
    },
  };
}
