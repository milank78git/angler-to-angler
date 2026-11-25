"""Reconcile voided purchases with overlap, pagination and a durable database watermark."""
from datetime import datetime, timedelta, timezone
import hashlib
import os

PACKAGE = "app.anglers.journal"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"


def main():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    import psycopg
    from psycopg.types.json import Jsonb
    credentials, _ = google.auth.default(scopes=[SCOPE])
    session = AuthorizedSession(credentials)
    end = datetime.now(timezone.utc) - timedelta(minutes=2)
    with psycopg.connect("") as db:
        db.execute("select pg_advisory_xact_lock(37912018)")
        start, mode = db.execute("select void_checked_at,mode from angler_commerce.settings for update").fetchone()
        if mode not in ("live","test") or mode != os.environ.get("PLAY_PURCHASE_MODE"):
            raise ValueError("Select the matching Play environment")
        if start and start < end - timedelta(days=29):
            raise ValueError("Reconcile the missing historical earnings reports before resuming the Play watermark")
        first = start - timedelta(hours=1) if start else end - timedelta(days=29)
        params = {"startTime":int(first.timestamp()*1000),"endTime":int(end.timestamp()*1000),"type":0}
        url = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/purchases/voidedpurchases"
        while True:
            response = session.get(url, params=params, timeout=30)
            if response.status_code != 200:
                raise RuntimeError(f"Play voids returned HTTP {response.status_code}")
            page = response.json()
            for item in page.get("voidedPurchases",[]):
                token_hash = hashlib.sha256(item["purchaseToken"].encode()).hexdigest()
                db.execute("select angler_commerce.receipt('void',%s)",(Jsonb({"hash":token_hash}),))
            token = page.get("tokenPagination",{}).get("nextPageToken")
            if not token:
                break
            params = {"token":token}
        db.execute("update angler_commerce.settings set void_checked_at=%s",(end,))


if __name__ == "__main__":
    main()
