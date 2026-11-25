/** The selected app language takes precedence over the phone language and fishing country. */
const guideTag = globalThis.location?.pathname?.endsWith('/guide.html') && new URLSearchParams(location.search).get('lang');
const requested = guideTag || globalThis.Device?.localeTag?.() || globalThis.Device?.locale?.() || navigator.language;
function baseTag(tag) {
  try { return new Intl.Locale(tag).baseName; }
  catch { return 'en'; }
}
export const languageTag = baseTag(requested);
const parts = languageTag.toLowerCase().split('-');
if (parts[0] === 'nb') parts[0] = 'no';
export const language = parts[0];
export let contentLanguage = 'en';
let messages = {};

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw Error('Missing language resource ' + path);
  return response.json();
}

/** Overlay existing packs from least to most specific so partial regional packs inherit each message. */
export async function loadDictionary() {
  const [english, available] = await Promise.all([json('strings-en.json'), json('ui-locales.json')]);
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('-'))
    .filter(code => code !== 'en' && available.includes(code));
  const packs = await Promise.all(candidates.map(code => json('strings-' + code + '.json').catch(() => null)));
  messages = { ...english };
  contentLanguage = 'en';
  packs.forEach((pack, index) => {
    if (pack) {
      Object.assign(messages, pack);
      contentLanguage = candidates[index];
    }
  });
}

export function label(key) {
  return messages[key] ?? key;
}
