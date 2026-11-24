import { contentLanguage, loadDictionary } from './i18n.js';
import { openGuide } from './guide.js';
await loadDictionary();
document.documentElement.lang = contentLanguage;
await openGuide(location.hash.slice(1));
document.getElementById('guide-close').hidden = true;
