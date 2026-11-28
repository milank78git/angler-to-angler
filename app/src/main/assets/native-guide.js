import { contentLanguage, label, loadDictionary } from './i18n.js';
import { openGuide } from './guide.js';

document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
// Load the requested app language before composing the standalone Android help page.
await loadDictionary();
document.documentElement.lang = contentLanguage;
document.title = label('common.help');
// Native help links carry a chapter in the fragment. An unknown chapter opens the searchable index.
await openGuide({ topic: location.hash.slice(1) });
