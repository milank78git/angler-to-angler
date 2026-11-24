/** Resolve the phone's BCP 47 preference independently from the country where the angler fishes. */
export const languageTag = (globalThis.location?.pathname?.endsWith('/guide.html') && new URLSearchParams(location.search).get('lang')) || globalThis.Device?.localeTag?.() || globalThis.Device?.locale?.() || navigator.language || 'en';
const primary = languageTag.toLowerCase().split('-')[0];
export const language = primary === 'nb' ? 'no' : primary;
let messages = {};
// Screen readers use the language of the loaded text. Formatting retains the phone's full locale.
export let contentLanguage = language === 'cs' ? 'cs' : 'en';

/** Only packaged dictionaries are loaded. Missing translations use the original English message. */
export async function loadDictionary() {
  if (!/^[a-z]{2,3}$/.test(language) || language === 'en') return;
  try {
    const response = await fetch('strings-' + language + '.json');
    if (response.ok) {
      messages = await response.json();
      contentLanguage = language;
    }
  } catch { /* Czech and English source strings remain usable offline in older packages. */ }
}
export function translate(czech, english) {
  return messages[english] || (language === 'cs' ? czech : english);
}
