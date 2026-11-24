"""Render a versioned, idempotent species insert for a new market migration from the app catalogue."""
import json
import re
from pathlib import Path

assets = Path(__file__).resolve().parents[1]/'app/src/main/assets'
names = [f['latin'] for f in json.loads((assets/'europe-fish.json').read_text())['species']]
if not all(re.fullmatch(r"[A-Za-z0-9 .×()_-]+", n) and len(n) <= 60 for n in names):
    raise ValueError('Unexpected scientific name; review escaping and the stored market field length')
print("insert into angler_market.species(latin) select unnest(string_to_array($fish$"+
      "\n".join(names)+"$fish$,chr(10))) on conflict do nothing;")
