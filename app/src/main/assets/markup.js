import purifier from './purify.es.mjs';

let configured = false;

/** Parse packaged templates into detached nodes before attaching them to a live WebView. */
function fragment(markup) {
  if (!configured) {
    purifier.addHook('uponSanitizeAttribute', (element, attribute) => {
      if (element.localName === 'use' && ['href', 'xlink:href'].includes(attribute.attrName)) {
        attribute.keepAttr =
          attribute.attrName === 'href' && /^icons\.svg#[a-z0-9-]+$/.test(attribute.attrValue);
      }
    });
    configured = true;
  }
  return purifier.sanitize(markup, { RETURN_DOM_FRAGMENT: true, ADD_TAGS: ['use'] });
}

/** Sanitize the detached template before replacing the current set of DOM children. */
export function replaceMarkup(target, markup) {
  target.replaceChildren(fragment(markup));
}

/** Insert the sanitized fragment at the requested position relative to its target.
 * @param {Element} target @param {'beforeend'|'beforebegin'|'afterend'|'afterbegin'} position @param {string} markup
 */
export function insertMarkup(target, position, markup) {
  const nodes = fragment(markup);
  switch (position) {
    case 'beforeend':
      target.append(nodes);
      break;
    case 'afterbegin':
      target.prepend(nodes);
      break;
    case 'beforebegin':
      target.before(nodes);
      break;
    case 'afterend':
      target.after(nodes);
      break;
  }
}
