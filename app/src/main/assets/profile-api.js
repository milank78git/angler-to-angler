import { t } from './ui.js';
import { pixelJpeg } from './photo.js';

let sequence = 0;
const pending = new Map();
/** Remove the pending entry before completing the request matching the native reply ID. */
window.profileReply = (id, status, result) => {
  const callback = pending.get(id);
  if (callback) {
    pending.delete(id);
    clearTimeout(callback.timer);
    if (status === 200) callback.resolve(result);
    else callback.reject(Object.assign(new Error('Profile request failed'), { status, reason: result }));
  }
};

/** Correlate a native profile request with its reply and retire the entry after success, failure or timeout. */
export function rpc(operation, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error('Profile request timed out'), { status: 504 }));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    try {
      window.Device.profileRequest(id, operation, JSON.stringify(args));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

/** Map account, access, revision and capacity errors to localized recovery text. */
export function failure(error) {
  switch (error.status) {
    case 401:
      return t('profile_api.sign_in_again_to_use_the_online');
    case 403:
      return t('profile_api.you_do_not_have_access_to_this');
    case 404:
      return t('profile_api.this_profile_is_private_or_no_longer');
    case 409:
      return t('profile_api.the_record_changed_or_the_photo_was');
    case 429:
      return t(error.reason === 'pending_review_limit' ? 'verification.queue_full' : 'limits.hourly');
    case 400:
      return t('profile_api.the_details_could_not_be_accepted_check');
    default:
      return t('profile-api.service.unavailable.check.your.connection.and.retry');
  }
}

/** Only re-encoded pixels leave the journal. Reduce dimensions again on noisy images. */
export async function photoPayload(file, edge, limit, encode = pixelJpeg) {
  let pixels = await encode(file, edge);
  while (pixels.size > limit && edge > 128) {
    edge = Math.floor(edge * 0.8);
    pixels = await encode(file, edge);
  }
  if (pixels.size > limit) throw Error('photo');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('photo'));
    reader.onload = () => resolve(/** @type {string} */ (reader.result).split(',')[1]);
    reader.readAsDataURL(pixels);
  });
}
