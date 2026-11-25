import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("settlement", Path(__file__).resolve().parents[1] / "scripts/play/settlement.py")
settlement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(settlement)


class Earnings(unittest.TestCase):
    def report(self, entries):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"earnings.csv"
            with path.open("w", encoding="utf-16",newline="") as data:
                writer = csv.writer(data)
                writer.writerow(["Package ID","SKU ID","Description","Transaction Type","Refund Type","Merchant Currency","Buyer Currency","Amount (Merchant Currency)"])
                for kind, amount, refund in entries:
                    writer.writerow([settlement.PACKAGE,"credits_100_czk","GPA.123",kind,refund,"CZK","CZK",amount])
            return list(settlement.earnings(path))

    def test_net_and_refund(self):
        rows=[("Charge","100.00",""),("Google fee","-12.40",""),("Tax","-17.35","")]
        self.assertEqual(self.report(rows),[("GPA.123","credits_100_czk","settle",7025)])
        self.assertEqual(self.report([("Charge refund","-100.00","Full")])[0][2],"void")
        with self.assertRaises(ValueError): self.report([("Charge refund","-10.00","Partial")])
        with self.assertRaises(ValueError): self.report([("Charge","100.00","")])
