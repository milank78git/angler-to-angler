import { by, t, toast } from './ui.js';
import { point } from './domain.js';

let sequence = 0;

/** Own the request, accepted fix and manual edits for one mounted catch form. */
export function bindCatchPosition(view, initial = null) {
  const button = by('gps'),
    latitude = by('lat'),
    longitude = by('lon');
  const label = button.querySelector('span');
  const idleLabel = label.textContent;
  let pending = 0,
    accepted = initial?.source === 'device' ? initial : null;
  if (initial) {
    latitude.value = String(initial.lat);
    longitude.value = String(initial.lon);
    by('kind').value = initial.kind;
  }

  /** Cancel only the pending native request and restore the original button caption. */
  function cancel() {
    if (pending) window.Device.cancelLocation(pending);
    pending = 0;
    label.textContent = idleLabel;
  }
  /** Discard the native fix as soon as an angler changes either coordinate by hand. */
  function manualEdit() {
    cancel();
    accepted = null;
  }
  /** Accept only the fix for this form's outstanding request and mark the draft dirty. */
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
    if (!window.Device) return toast(t('common.gps_is_available_on_android'));
    pending = ++sequence;
    label.textContent = t('catch_position.cancel_location_request');
    window.Device.location(pending);
  };

  return {
    waiting: () => pending !== 0,
    /** Preserve the origin, accuracy and observation time alongside a complete coordinate pair. */
    read() {
      const coords = point(latitude.value, longitude.value);
      return (
        coords && {
          ...coords,
          source: accepted ? 'device' : 'manual',
          accuracy: accepted?.accuracy ?? null,
          time:
            accepted?.time ??
            (initial?.lat === coords.lat && initial?.lon === coords.lon ? initial.time : Date.now()),
          kind: by('kind').value,
        }
      );
    },
    /** Detach the native result listener and cancel any unfinished location lookup. */
    dispose() {
      window.removeEventListener('angler-position', receive);
      cancel();
    },
  };
}
