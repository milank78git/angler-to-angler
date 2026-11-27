"""Build deployable Digital Asset Links and a token-free, localized browser fallback."""
import argparse
import html
import json
import os
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
parser.add_argument('--certificate', default=os.environ.get('ANDROID_ROTATED_CERTIFICATE', ''),
                    help='Public SHA-256 fingerprint of the current Android signing certificate')
args = parser.parse_args()
pin = args.certificate.replace(':', '').upper()
if not re.fullmatch(r'[0-9A-F]{64}', pin) or pin == '8194987893A64EE0ABF250377C54A7D939B81743FA95020DD4A701EA45AD92B6':
    parser.error('Configure a rotated Android signing certificate')
certificates = [':'.join(pin[i:i+2] for i in range(0, 64, 2))]
package = 'app.anglers.journal'
root = args.output
well_known = root / '.well-known'
well_known.mkdir(parents=True, exist_ok=True)
(well_known / 'assetlinks.json').write_text(json.dumps([{
    'relation': ['delegate_permission/common.handle_all_urls'],
    'target': {'namespace': 'android_app', 'package_name': package,
               'sha256_cert_fingerprints': certificates}
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
