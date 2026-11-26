import { contentLanguage, label, loadDictionary } from './i18n.js';
import { openGuide } from './guide.js';

document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
await loadDictionary();
document.documentElement.lang = contentLanguage;
document.title = label('common.help');
await openGuide({ topic: location.hash.slice(1) });
