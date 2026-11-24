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
    if isinstance(config, dict) and set(config) == {"url", "publishableKey", "deploymentCs", "deploymentEn"}:
        # Accept the settings already in existing GitHub Actions variables and local build files.
        config["deploymentNotices"] = {"cs": config.pop("deploymentCs"), "en": config.pop("deploymentEn")}
    if not isinstance(config, dict) or set(config) != {"url", "publishableKey", "deploymentNotices"}:
        raise SystemExit("Expected a public account URL, publishableKey and localized deployment notices")
    notices = config["deploymentNotices"]
    if (not isinstance(notices, dict) or not {"en", "cs"}.issubset(notices)
            or not all(re.fullmatch(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*", k) and isinstance(v, str) and v.strip()
                       for k, v in notices.items())
            or not all(isinstance(config[k], str) for k in ("url", "publishableKey"))):
        raise SystemExit("Invalid account configuration or missing deployment notice")
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
