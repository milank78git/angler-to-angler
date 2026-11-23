"""Write public identity settings into build assets. Never package service-role keys."""
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit

source = os.environ.get("ANGLER_ACCOUNT_CONFIG_FILE")
raw = Path(source).read_text() if source else os.environ.get("ANGLER_ACCOUNT_CONFIG", "{}")
config = json.loads(raw or "{}")
if config != {}:
    allowed = {"url", "publishableKey", "deploymentCs", "deploymentEn"}
    if not isinstance(config, dict) or set(config) != allowed or not all(isinstance(v, str) and v.strip() for v in config.values()):
        raise SystemExit("Expected public account URL, publishableKey and both deployment notices")
    url = urlsplit(config["url"])
    if url.scheme != "https" or not url.hostname or url.username or url.password or config["url"] != "https://" + url.netloc:
        raise SystemExit("Account URL must be a bare HTTPS origin")
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", config["publishableKey"]):
        raise SystemExit("Only a public Supabase publishable key can be packaged")
out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

root = Path(__file__).resolve().parents[1]
for document in ("LICENSE", "NOTICE"):
    shutil.copyfile(root / document, out.with_name(document.lower() + ".txt"))
