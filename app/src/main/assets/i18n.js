/** Resolve the phone's BCP 47 preference independently from the country where the angler fishes. */
export const languageTag = (globalThis.location?.pathname?.endsWith('/guide.html') && new URLSearchParams(location.search).get('lang')) || globalThis.Device?.localeTag?.() || globalThis.Device?.locale?.() || navigator.language || 'en';
const primary = languageTag.toLowerCase().split('-')[0];
export const language = primary === 'nb' ? 'no' : primary;
let messages = {};
// Screen readers use the language of the loaded text. Formatting retains the phone's full locale.
export let contentLanguage = language === 'cs' ? 'cs' : 'en';

let englishLabels = {};

async function dictionary(code) {
  const response = await fetch('strings-' + code + '.json');
  if (!response.ok) throw Error('Missing locale ' + code);
  return response.json();
}

export async function loadDictionary() {
  const localized = language !== 'en' && /^[a-z]{2,3}$/.test(language);
  const [english, local] = await Promise.all([
    dictionary('en'), localized ? dictionary(language).catch(() => null) : null,
  ]);
  englishLabels = english;
  if (local) { messages = local; contentLanguage = language; }
}

/** Resolve a stable interface key using the phone's language and the bundled English fallback. */
export function label(key) {
  return messages[key] || englishLabels[key];
}
export function translate(czech, english) {
  return messages[english] || (language === 'cs' ? czech : english);
}
