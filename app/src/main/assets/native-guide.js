import { loadDictionary } from './i18n.js';
import { openGuide } from './guide.js';
await loadDictionary();
await openGuide(location.hash.slice(1));
document.getElementById('guide-close').hidden = true;
