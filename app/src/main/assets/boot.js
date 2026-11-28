import { loadDictionary } from './i18n.js';
// Screen modules initialize translated labels during import. Load the selected dictionary first.
await loadDictionary();
await import('./app.js');
