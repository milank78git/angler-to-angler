"""Build the anonymous reader with the same public configuration and rendering assets as Android."""
import argparse
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('account_config', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
config = json.loads(args.account_config.read_text())
origin = config['url']
parts = urlsplit(origin)
if (parts.scheme != 'https' or origin != 'https://' + parts.netloc
        or not re.fullmatch(r'[a-z0-9.-]+', parts.netloc)
        or not re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]+', config['publishableKey'])):
    raise SystemExit('Expected a public HTTPS origin and publishable key')
args.output.mkdir(parents=True, exist_ok=True)
for name in ['reader.css', 'reader.js']:
    shutil.copyfile(root / 'web/catch-card' / name, args.output / name)
for name in ['public-card-view.js', 'public-card-view.css']:
    shutil.copyfile(root / 'app/src/main/assets' / name, args.output / name)
template = (root / 'web/catch-card/index.html').read_text()
(args.output / 'index.html').write_text(template.replace('__API_ORIGIN__', origin))
(args.output / 'reader-config.js').write_text(
    'export const apiOrigin = ' + json.dumps(origin) + ';\n'
    + 'export const publishableKey = ' + json.dumps(config['publishableKey']) + ';\n')
