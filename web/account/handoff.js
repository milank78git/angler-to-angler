// Only a one-time PKCE code or an expiration notice can reach the fixed Android package.
const parameters = new URLSearchParams(location.search);
const fragment = new URLSearchParams(location.hash.slice(1));
if (location.search || location.hash) history.replaceState(null, '', location.pathname);
const packageName = document.querySelector('meta[name="android-package"]').content;
const code = parameters.get('code');
let query = '';
if (parameters.get('error_code') === 'otp_expired' || fragment.get('error_code') === 'otp_expired') {
  query = 'error_code=otp_expired';
} else if (parameters.getAll('code').length === 1 && /^[A-Za-z0-9_-]{1,256}$/.test(code || '')) {
  query = 'code=' + encodeURIComponent(code);
}
const language = navigator.language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
document.documentElement.lang = language;
for (const section of document.querySelectorAll('section[lang]')) {
  section.hidden = section.lang !== language;
  const action = section.querySelector('a');
  if (query && /Android/i.test(navigator.userAgent)) {
    action.href = 'intent://account/callback?' + query + '#Intent;scheme=' + packageName + ';package=' + packageName + ';end';
    action.hidden = false;
  }
}
