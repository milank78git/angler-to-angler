"""Exercise daily edition changes, retry behavior, and the independent publication digest."""
from datetime import date
from hashlib import sha256
import gzip
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import rule_sources as sources

job = runpy.run_path(str(ROOT / "scripts/refresh-atlas-rules.py"))
release = job["release"]
bundled = {n: (release["ASSETS"] / n).read_text() for n in ("catalog.json", "europe-rules.json")}
day = date(2026, 11, 26)
pike_text = "Each day you can only take from rivers: 1 pike (up to 65cm)"


def definition(body):
    return {"articleClass": "article", "templateSha256": sha256(body.encode()).hexdigest()}


def html(body):
    return '<main><div class="article">' + body + '</div></main>'


def change_size(daily, length):
    return html(f"Each day you can only take from rivers: {daily} pike (up to {length}cm)")


def ris(water, cm, upper=None):
    row = {"datumOd": 9, "datumDo": 10, "platny": 11, "jeHajen": 12, "druhRyby": 6, "dolniMira": 13}
    nodes = [["Reactive", 1], {"path": 2}, "/karta-reviru/-/" + water["source"].split("/")[-1],
             {"miryAHajeni": 4}, [5], row, {"id": 7}, 75, None, "2026-06-16", "2026-12-31", True, False, cm]
    if upper:
        row["horniMira"] = len(nodes)
        nodes.append(upper)
    return '<script type="application/json" id="__NUXT_DATA__">' + json.dumps(nodes) + '</script>'


class DailyRulesTest(unittest.TestCase):
    def test_czech_sizes_keep_different_trout_and_nontrout_limits(self):
        text = "Title (2) a) Z (Sander lucioperca) 45 cm, b) H (Hucho hucho) 65 cm. (3) a) H (Hucho hucho) 70 cm."
        wrapped = definition(text.replace("45 cm", "# cm").replace("65 cm", "# cm").replace("70 cm", "# cm"))
        rows = [{"species": ["Sander lucioperca"]}, {"species": ["Hucho hucho"]}]
        found = sources.extract_national("cz11", wrapped, rows, html(text))
        self.assertEqual([(r["scope"], r["minCm"]) for r in found], [("nontrout", 45), ("nontrout", 65), ("cztrout", 70)])
        with self.assertRaises(sources.SourceChanged):
            sources.extract_national("cz11", wrapped, rows, html(text.replace("Title", "Title with exception")))

    def test_cross_year_closure_and_disagreeing_authority_dates(self):
        text = "(1) Od 1. prosince do 15. dubna scope"
        adapter = definition("(1) Od # do # scope") | {"months": json.loads(sources.DATA.read_bytes())["sources"]["cz13"]["months"],
                                                      "paragraphs": {"allFreshwater": "1"}}
        row = {"species": [], "allFreshwater": True}
        self.assertEqual(sources.extract_national("cz13", adapter, [row], html(text))[0]["closed"], ["12-01", "04-15"])
        with self.assertRaises(ValueError):
            sources.extract_national("cz13", adapter, [row], html(text.replace("15.", "31.")))
        with self.assertRaises(sources.SourceChanged):
            sources.extract_national("gb", definition("# to # and # to #"), [{}],
                                     html("15 March to 15 June and 16 March to 15 June"))

    def test_refresh_withdraw_retry_and_recover(self):
        pins = json.loads((sources.DATA.parent / "source-fingerprints.json").read_bytes())
        data = json.loads(bundled["europe-rules.json"])
        waters = json.loads(bundled["catalog.json"])["waters"]
        url = data["sources"]["gbsize"]["url"]
        tracked_url = data["sources"]["sk"]["url"]
        keys = {row["url"]: key for key, row in data["sources"].items()}
        config = json.loads(sources.DATA.read_bytes())
        config["sources"] = {"gbsize": definition("Each day you can only take from rivers: # pike (up to #cm)")}
        documents = {w["source"]: ris(w, 56, 85) for w in waters} | {url: change_size(2, 70)}

        def fetch(target):
            value = documents[target]
            if isinstance(value, Exception):
                raise value
            return value

        def fingerprints(target):
            return "changed" if target == tracked_url else pins[keys[target]]

        def refresh(previous, when):
            return job["refresh_rules"](bundled, previous, when, fetch, fingerprints)

        with tempfile.TemporaryDirectory() as folder:
            config_file = Path(folder) / "rule-imports.json"
            config_file.write_text(json.dumps(config))
            (config_file.parent / "source-fingerprints.json").write_text(json.dumps(pins))
            with patch.dict(job["refresh_rules"].__globals__, {"DATA": config_file}):
                first, issues = refresh({}, day)
                self.assertTrue(any(e.startswith("sk:") for e in issues))
                rules = json.loads(first["europe-rules.json"])
                imported = next(r for r in rules["entries"] if r["source"] == "gbsize")
                self.assertEqual((imported["daily"], imported["maxCm"]), (2, 70))
                self.assertEqual(rules["sources"]["sk"]["reviewBy"], "2026-11-25")
                self.assertEqual(rules["sources"]["gbsize"]["checked"], day.isoformat())
                self.assertEqual(json.loads(first["catalog.json"])["waters"][0]["datedRules"]["pike"][0]["maxCm"], 85)
                self.assertEqual(refresh(first, day)[0], first)
                for target in documents:
                    documents[target] = OSError("offline")
                retry, _ = refresh(first, date(2026, 11, 27))
                self.assertEqual(retry, first)
                documents[url] = html(pike_text + " except on weekends")
                stale, warnings = refresh(first, date(2026, 11, 28))
                self.assertTrue(any(e.startswith("gbsize:") for e in warnings))
                self.assertEqual(json.loads(stale["europe-rules.json"])["sources"]["gbsize"]["reviewBy"], "2026-11-27")
                documents[url] = change_size(1, 73)
                restored, _ = refresh(stale, date(2026, 11, 30))
                self.assertEqual(json.loads(restored["europe-rules.json"])["sources"]["gbsize"]["checked"], "2026-11-30")
                self.assertEqual([r.get("validUntil") for r in rules["entries"] if r["source"] == "atl26"],
                                 [r.get("validUntil") for r in data["entries"] if r["source"] == "atl26"])

    def test_publisher_rejects_substituted_rule_output_and_packs_verified_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            release["build"](folder, folder, day.isoformat(), False)
            rule_data = dict(bundled)
            rules = json.loads(rule_data["europe-rules.json"])
            rules["updated"] = day.isoformat()
            rule_data["europe-rules.json"] = json.dumps(rules)
            candidate = folder / "rules.json"
            candidate.write_bytes(release["encode"](rule_data))
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                job["apply"](folder, candidate, "0" * 64)
            job["apply"](folder, candidate, sha256(candidate.read_bytes()).hexdigest())
            atlas = json.loads(gzip.decompress((folder / "atlas.json.gz").read_bytes()))
            self.assertEqual(atlas["anglingRules"], rule_data)
            self.assertEqual(json.loads((folder / "manifest.json").read_bytes())["asOf"], day.isoformat())


if __name__ == "__main__":
    unittest.main()
