import {renderPublicCard} from './public-card-view.js';
import {apiOrigin, publishableKey} from './reader-config.js';

const cs = navigator.language.toLowerCase().startsWith('cs');
const t = (cz,en) => cs ? cz : en;
const content = document.querySelector('#content'), retry = document.querySelector('#retry');
const title = t('Rybáři sobě','Angler to Angler');
document.documentElement.lang = cs ? 'cs' : 'en';
document.querySelector('#brand').textContent = title;
document.querySelector('#heading').textContent = t('Sdílený úlovek','Shared catch');
retry.textContent = t('Zkusit znovu','Try again');
const missing = t('Tato karta není dostupná. Autor ji mohl stáhnout.', 'This card is unavailable. Its author may have withdrawn it.');
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
    status(t('Otevři celý odkaz, který ti rybář poslal z aplikace Rybáři sobě.',
      'Open the full link the angler shared with you from Angler to Angler.'));
    return;
  }
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) { status(missing); return; }
  status(t('Načítám úlovek…','Loading catch…'));
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
    renderPublicCard(content,card,cs ? 'cs' : 'en');
    document.title = card.species + ' · ' + title;
  } catch {
    if (current.signal.aborted) return;
    status(t('Kartu se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.',
      'Could not load the card. Check your connection and try again.'));
    retry.hidden = false;
  }
}
retry.onclick = refresh;
window.addEventListener('hashchange',refresh);
window.addEventListener('pageshow',refresh);
document.addEventListener('visibilitychange',refresh);
