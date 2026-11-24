"""Return a validated build-time Android App Link hostname, for the Android manifest."""
import os
import re

host = os.environ.get("ANGLER_APP_LINK_HOST", "").strip() or "horistum.com"
if len(host) > 253 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                              for label in host.split(".")) or "." not in host:
    raise SystemExit("ANGLER_APP_LINK_HOST must be a DNS hostname")
print(host)
