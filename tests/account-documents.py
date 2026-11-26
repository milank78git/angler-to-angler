"""Pin accepted legal texts per revision and compare the generated public copy."""
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
assets = root / "app/src/main/assets"
store = (root / "app/src/main/java/app/anglers/journal/AccountStore.java").read_text()
revision = re.search(r'String REVISION = "([0-9-]+)"', store)[1]
pins = json.loads((root / "data/account-document-revisions.json").read_bytes())[revision]
actual = {}
with tempfile.TemporaryDirectory() as temp:
    subprocess.run(["python3", root / "scripts/build-account-pages.py", temp], check=True)
    for locale in ("cs", "en"):
        for document in ("terms", "privacy", "optional-profile"):
            file = assets / f"{document}-{locale}.txt"
            actual[file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
            paragraphs = file.read_text().strip().split("\n\n")
            assert revision in paragraphs[0]
            route = "terms" if document == "terms" else "privacy"
            page = (Path(temp) / route / "index.html").read_text()
            assert all(html.escape(part) in page for part in paragraphs), file.name
assert pins == actual, "Publish changed legal texts under a new revision"
