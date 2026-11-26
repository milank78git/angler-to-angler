"""Generate a self-contained Pages handoff. No runtime origin, package or destination comes from the URL."""
import argparse
import base64
import hashlib
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PILOT = 'app.anglers.journal'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--preview', action='store_true', help='Use exclusively with a local Android preview fixture')
args = parser.parse_args()
package = PILOT + ('.preview' if args.preview else '')
script = (ROOT / 'web/account/handoff.js').read_text()
style = ('html{font:110%/1.55 system-ui,sans-serif;color:#19362f;background:#f6f7f1}'
         'main{max-width:32rem;margin:7vh auto;padding:1.2rem}h1{line-height:1.15}'
         'a{display:inline-block;padding:.65rem 1rem;background:#155447;color:white;border-radius:.5rem}'
         '[hidden]{display:none}a:focus-visible{outline:3px solid #ba6000;outline-offset:4px}')


def digest(text):
    return base64.b64encode(hashlib.sha256(text.encode()).digest()).decode('ascii')


policy = (f"default-src 'none'; base-uri 'none'; form-action 'none'; "
          f"script-src 'sha256-{digest(script)}'; style-src 'sha256-{digest(style)}'")
page = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">',
        f'<meta http-equiv="Content-Security-Policy" content="{policy}">',
        f'<meta name="android-package" content="{package}"><title>Angler to Angler</title>',
        f'<style>{style}</style></head><body><main>']
for locale in ('en', 'cs'):
    pack = json.loads((ROOT / 'app/src/main/assets' / f'strings-{locale}.json').read_bytes())
    title, action, help_text = [html.escape(pack[key]) for key in (
        'account.pages_title', 'account.pages_open', 'account.browser_return')]
    page.append(f'<section lang="{locale}"><h1>{title}</h1><a hidden>{action}</a><p>{help_text}</p></section>')
page.append(f'</main><script>{script}</script></body></html>')
folder = args.output / 'account'
folder.mkdir(parents=True, exist_ok=True)
(folder / 'index.html').write_text('\n'.join(page))
# The project home also provides the account instructions, with no forced redirect.
(args.output / 'index.html').write_text('\n'.join(page))

# The store requires public, directly accessible privacy and account deletion information.
for route in ("terms", "privacy", "delete-account"):
    sections = []
    for locale in ("en", "cs"):
        assets = ROOT / "app/src/main/assets"
        messages = json.loads((assets / f"strings-{locale}.json").read_bytes())
        paragraphs = []
        if route in ("terms", "privacy"):
            names = ("privacy", "optional-profile") if route == "privacy" else ("terms",)
            paragraphs = [part for name in names for part in
                          (assets / f"{name}-{locale}.txt").read_text().strip().split("\n\n")]
            title = paragraphs.pop(0)
        else:
            title = messages["store.delete-account"]
            paragraphs = [messages["store.deletion_steps"], messages["store.deletion_scope"]]
        sections.append(f'<section lang="{locale}"><h1>{html.escape(title)}</h1>' +
                        ''.join('<p>'+html.escape(p)+'</p>' for p in paragraphs) +
                        '<a href="mailto:info@horistum.com">info@horistum.com</a></section>')
    dest = args.output / route
    dest.mkdir(exist_ok=True)
    (dest / "index.html").write_text('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Angler to Angler</title>'
        '<style>'+style+'</style></head><body><main>'+''.join(sections)+'</main></body></html>')
