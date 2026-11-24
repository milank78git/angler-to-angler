import {renderPublicCard} from './public-card-view.js';
import {apiOrigin, publishableKey} from './reader-config.js';

import { label as t, languageTag, contentLanguage, loadDictionary } from './i18n.js';

await loadDictionary();
const content = document.querySelector('#content'), retry = document.querySelector('#retry');
const title = t('app.name');
document.documentElement.lang = contentLanguage;
document.querySelector('#brand').textContent = title;
document.querySelector('#heading').textContent = t('public_reader.shared_catch');
retry.textContent = t('common.try_again');
const missing = t('public_reader.this_card_is_unavailable_its_author_may');
let request;

function status(text) {
  const p = document.createElement('p');
  p.textContent = text;
  content.replaceChildren(p);
}

/** Never retain a card across a different link, a hidden page or a browser history restore. */
async function refresh() {
  request?.abort();
  const current = new AbortController();
  request = current;
  content.replaceChildren();
  document.title = title;
  retry.hidden = true;
  if (document.hidden) return;
  const id = location.hash.slice(1);
  if (!id) {
    status(t('public_reader.open_the_full_link_the_angler_shared'));
    return;
  }
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) { status(missing); return; }
  status(t('public_reader.loading_catch'));
  try {
    const response = await fetch(apiOrigin + '/rest/v1/rpc/angler_open_catch_card', {
      method:'POST', headers:{apikey:publishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({link_id:id}), credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer', signal:current.signal,
    });
    if (!response.ok) throw Error('Service unavailable');
    // PostgREST can represent a scalar SQL NULL with an empty response body.
    const body = await response.text();
    const card = body.trim() ? JSON.parse(body) : null;
    if (current.signal.aborted) return;
    if (!card) { status(missing); return; }
    renderPublicCard(content,card,languageTag,t);
    document.title = card.species + ' · ' + title;
  } catch {
    if (current.signal.aborted) return;
    status(t('public_reader.could_not_load_the_card_check_your'));
    retry.hidden = false;
  }
}
retry.onclick = refresh;
window.addEventListener('hashchange',refresh);
window.addEventListener('pageshow',refresh);
document.addEventListener('visibilitychange',refresh);
