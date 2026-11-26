import { t } from './ui.js';
import { pixelJpeg } from './photo.js';

let sequence = 0;
const pending = new Map();
window.profileReply = (id, status, result) => {
  const callback = pending.get(id);
  if (callback) {
    pending.delete(id);
    if (status === 200) callback.resolve(result);
    else callback.reject(Object.assign(new Error('Profile request failed'), { status }));
  }
};

export function rpc(operation, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    try {
      window.Device.profileRequest(id, operation, JSON.stringify(args));
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

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
      return t('account.too_many_attempts_please_try_again_later');
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
