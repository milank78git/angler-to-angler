// Keep invitation codes out of server logs and browser history.
const inviteCode = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const valid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(inviteCode);
const pkg = /** @type {HTMLMetaElement} */ (document.querySelector('meta[name="android-package"]')).content;
for (const section of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('section[lang]'))) {
  section.hidden = section.lang !== (navigator.language.toLowerCase().startsWith('cs') ? 'cs' : 'en');
  if (!valid) continue;
  section.querySelector('code').textContent = inviteCode;
  const link = section.querySelector('a');
  link.href = 'intent://group/join?code=' + inviteCode + '#Intent;scheme=' + pkg + ';package=' + pkg + ';end';
  link.hidden = !/Android/i.test(navigator.userAgent);
}
