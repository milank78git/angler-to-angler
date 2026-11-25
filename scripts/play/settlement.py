"""Reconcile the Czech Play ledger and produce stable monthly payout instructions."""
import argparse
import csv
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path
import sys

PACKAGE = "app.anglers.journal"
SKUS = {"credits_50_czk", "credits_100_czk"}


def earnings(path):
    """Fail closed on incomplete, foreign-currency or adjusted reports pending manual review."""
    totals = defaultdict(lambda: [Decimal(0), [], None])
    data = path.read_bytes()
    encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    import io
    for row in csv.DictReader(io.StringIO(data.decode(encoding))):
        if row["Package ID"] != PACKAGE or row["SKU ID"] not in SKUS:
            continue
        order = row["Description"].strip()
        kind = row["Transaction Type"]
        if not order.startswith("GPA.") or row["Merchant Currency"] != "CZK" or row["Buyer Currency"] != "CZK":
            raise ValueError("Unrecognized order or currency")
        if kind not in {"Charge", "Google fee", "Tax", "Charge refund", "Google fee refund", "Tax refund"}:
            raise ValueError(f"Review unsupported transaction type {kind}")
        if row.get("Refund Type") == "Partial":
            raise ValueError("Review partial refund before settlement")
        total = totals[order]
        if total[2] and total[2] != row["SKU ID"]:
            raise ValueError("An order contains multiple products")
        total[0] += Decimal(row["Amount (Merchant Currency)"])
        total[1].append(kind)
        total[2] = row["SKU ID"]
    if not totals:
        raise ValueError("No Czech credit-pack transactions found")
    for order, (amount, kinds, sku) in totals.items():
        cents = amount * 100
        if "Charge refund" in kinds:
            yield order, sku, "void", None
        elif kinds.count("Charge") == 1 and "Google fee" in kinds and cents == cents.to_integral_value() and cents > 0:
            yield order, sku, "settle", int(cents)
        else:
            raise ValueError(f"Unmatched charge, fee or refund for {order}")


def main():
    import psycopg
    from psycopg.types.json import Jsonb
    args = argparse.ArgumentParser(description=__doc__)
    tasks = args.add_subparsers(dest="action", required=True)
    load = tasks.add_parser("import-earnings")
    load.add_argument("report", type=Path)
    batch = tasks.add_parser("payout-batch")
    batch.add_argument("month", type=date.fromisoformat, help="First day of a closed month")
    paid = tasks.add_parser("record-paid")
    paid.add_argument("payout_id")
    paid.add_argument("bank_reference")
    tasks.add_parser("nature-balance")
    sent = tasks.add_parser("record-nature")
    sent.add_argument("bank_reference")
    sent.add_argument("partner")
    sent.add_argument("halers", type=int)
    sent.add_argument("paid_at", type=date.fromisoformat)
    args = args.parse_args()
    # libpq resolves the database from the operator's PGSERVICE / PG* setup.
    with psycopg.connect("") as db:
        env = db.execute("select mode from angler_commerce.settings").fetchone()[0]
        if env != "live":
            raise ValueError("Bank operations require a live ledger")
        if args.action == "import-earnings":
            for order, sku, action, cents in earnings(args.report):
                row = db.execute("select token_hash,units from angler_commerce.lots where order_ref=%s", (order,)).fetchone()
                if not row or sku != f"credits_{row[1]}_czk":
                    raise ValueError(f"Missing verified receipt for {order}")
                db.execute("select angler_commerce.receipt(%s,%s)", (action, Jsonb({"order":order, "hash":row[0], "net":cents})))
        elif args.action == "payout-batch":
            if args.month.day != 1 or args.month >= date.today().replace(day=1):
                raise ValueError("Select a completed month")
            recent = db.execute("select void_checked_at >= now()-interval '2 days' from angler_commerce.settings").fetchone()[0]
            if not recent:
                raise ValueError("Update the Google refund watermark before exporting payouts")
            rows = db.execute("""select p.id,p.author,p.halers,r.provider_reference
                from angler_commerce.payouts p join angler_commerce.recipients r using(author)
                where p.paid_at is null and p.exported_month is null
                and p.requested_at < (%s::date + interval '1 month') order by p.author for update of p""", (args.month,)).fetchall()
            for pid, author, cents, destination in rows:
                db.execute("select pg_advisory_xact_lock(hashtextextended(%s,37))", (str(author),))
                balance = db.execute("select (angler_commerce.wallet(%s)->>'earned')::bigint", (author,)).fetchone()[0]
                if balance < 0:
                    # A refund after the request reduced its cover. Release the reservation for a new request.
                    db.execute("delete from angler_commerce.payouts where id=%s", (pid,))
                    continue
                db.execute("update angler_commerce.payouts set exported_month=%s,destination=%s where id=%s",
                           (args.month, destination, pid))
            rows = db.execute("""select id,destination,halers,paid_at from angler_commerce.payouts
                                 where exported_month=%s order by id""", (args.month,)).fetchall()
            db.commit()
            writer = csv.writer(sys.stdout)
            writer.writerow(["payout_id","verified_destination","amount_CZK","paid_at"])
            writer.writerows((pid,ref,Decimal(cents)/100,completed or "") for pid,ref,cents,completed in rows)
        elif args.action == "record-paid":
            change = db.execute("""update angler_commerce.payouts set bank_reference=%s,paid_at=coalesce(paid_at,now())
                where id=%s and exported_month is not null and (bank_reference is null or bank_reference=%s)""",
                (args.bank_reference,args.payout_id,args.bank_reference))
            if change.rowcount != 1:
                raise ValueError("Unknown, unexported or differently confirmed payout")
        else:
            db.execute("select pg_advisory_xact_lock(37912017)")
            reserved = db.execute("select coalesce(sum(nature_halers),0) from angler_commerce.distribution").fetchone()[0]
            sent = db.execute("select coalesce(sum(halers),0) from angler_commerce.nature_transfers").fetchone()[0]
            if args.action == "nature-balance":
                print(f"Allocated CZK {reserved/100:.2f}, sent CZK {sent/100:.2f}, remaining CZK {(reserved-sent)/100:.2f}")
            else:
                expected = (args.partner,args.halers,args.paid_at)
                existing = db.execute("select partner,halers,paid_at from angler_commerce.nature_transfers where bank_reference=%s",
                                      (args.bank_reference,)).fetchone()
                if existing and existing != expected:
                    raise ValueError("Bank reference already recorded with different details")
                if not existing:
                    if args.halers <= 0 or args.halers > reserved-sent:
                        raise ValueError("Transfer exceeds available allocation")
                    db.execute("insert into angler_commerce.nature_transfers values(%s,%s,%s,%s)",(args.bank_reference,*expected))


if __name__ == "__main__":
    main()
