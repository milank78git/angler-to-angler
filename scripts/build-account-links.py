"""Build deployable Digital Asset Links and a token-free, localized browser fallback."""
import argparse
import html
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--certificate', default='81:94:98:78:93:A6:4E:E0:AB:F2:50:37:7C:54:A7:D9:39:B8:17:43:FA:95:02:0D:D4:A7:01:EA:45:AD:92:B6', help='Public release signing certificate SHA-256 fingerprint')
args = parser.parse_args()
if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){31}[0-9a-fA-F]{2}', args.certificate):
    parser.error('Expected a colon-separated SHA-256 fingerprint')
package = 'app.anglers.journal'
root = args.output
well_known = root / '.well-known'
well_known.mkdir(parents=True, exist_ok=True)
(well_known / 'assetlinks.json').write_text(json.dumps([{
    'relation': ['delegate_permission/common.handle_all_urls'],
    'target': {'namespace': 'android_app', 'package_name': package,
               'sha256_cert_fingerprints': [args.certificate.upper()]}
}], indent=2))
assets = Path(__file__).resolve().parents[1] / 'app/src/main/assets'
page = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        '<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
        '<title>Angler to Angler</title>']
for lang in ['en', 'cs']:
    strings = json.loads((assets / f'strings-{lang}.json').read_text())
    page.append(f'<section lang="{lang}"><h1>Angler to Angler</h1><p>{html.escape(strings["account.browser_return"])}</p></section>')
# Serve the exact no-trailing-slash callback path as text/html, without redirects or query logging.
folder = root / 'account' / package
folder.mkdir(parents=True, exist_ok=True)
(folder / 'callback.html').write_text('\n'.join(page))
