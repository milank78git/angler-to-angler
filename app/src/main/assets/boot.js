import { loadDictionary } from './i18n.js';
await loadDictionary();
await import('./app.js');
