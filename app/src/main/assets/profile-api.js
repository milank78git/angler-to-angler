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
      return t('Pro online profil se znovu přihlas.', 'Sign in again to use the online profile.');
    case 403:
      return t('K této akci nemáš přístup.', 'You do not have access to this action.');
    case 404:
      return t(
        'Profil není zveřejněný nebo už není dostupný.',
        'This profile is private or no longer available.',
      );
    case 409:
      return t(
        'Záznam se změnil nebo snímek již byl odeslán. Obnov zobrazení.',
        'The record changed or the photo was already submitted. Refresh the screen.',
      );
    case 429:
      return t(
        'Čeká už deset tvých snímků. Vyčkej na kontrolu.',
        'Ten of your photos are awaiting review. Wait for a decision.',
      );
    case 400:
      return t(
        'Údaje nelze přijmout. Zkontroluj čas, polohu a fotografii.',
        'The details could not be accepted. Check the time, location and photo.',
      );
    default:
      return t(
        'Služba není dostupná. Zkontroluj připojení a zkus to znovu.',
        'Service unavailable. Check your connection and retry.',
      );
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
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(pixels);
  });
}
