"""Refresh official fishing rules and seal their exact bytes into the validated water edition."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, timedelta
import gzip
import hashlib
from http.client import HTTPException
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys

from rule_sources import DATA, SourceChanged, extract_national, fetch_html, local_records

SCRIPTS = Path(__file__).resolve().parent
validate = runpy.run_path(str(SCRIPTS / "validate-atlas.py"))["validate"]
release = runpy.run_path(str(SCRIPTS / "water-release.py"))
monitor = runpy.run_path(str(SCRIPTS / "review-field-guide.py"))
encode = release["encode"]


def previous_rules(folder):
    """Only a prior edition signed by the pinned publication key may survive an outage."""
    path = folder / "manifest.json"
    if not path.exists() or "signature" not in json.loads(path.read_bytes()):
        return {}
    subprocess.run([sys.executable, str(SCRIPTS / "atlas-signature.py"), str(path)], check=True, stdout=subprocess.DEVNULL)
    packed = (folder / "atlas.json.gz").read_bytes()
    if hashlib.sha256(packed).hexdigest() != json.loads(path.read_bytes())["sha256"]:
        raise ValueError("Previous signed atlas digest mismatch")
    return json.loads(gzip.decompress(packed)).get("anglingRules", {})


def refresh_rules(bundled, previous, day, fetch=fetch_html, fingerprint=monitor["fingerprint"]):
    config = json.loads(DATA.read_bytes())
    pins = json.loads((DATA.parent / "source-fingerprints.json").read_bytes())
    rules = json.loads(bundled["europe-rules.json"])
    prior = json.loads(previous.get("europe-rules.json", "{}"))
    catalog = json.loads(bundled["catalog.json"])
    prior_waters = {w["id"]: w for w in json.loads(previous.get("catalog.json", "{}")).get("waters", [])}
    issues = []
    groups = {k: [r for r in rules["entries"] if r["source"] == k] for k in rules["sources"]}

    def source_update(item):
        key, base = item
        original = groups[key]
        adapter = config["sources"].get(key)
        pin = pins.get(key)
        if not adapter and (not pin or base.get("manualReview")):
            return key, base, original, None
        baseline = hashlib.sha256(encode([base, original, adapter, pin])).hexdigest()
        old = prior.get("sources", {}).get(key, {})
        if old.get("importBase") == baseline:
            old_rows = [r for r in prior["entries"] if r["source"] == key]
        else:
            old, old_rows = dict(base, importBase=baseline), original
        try:
            if adapter:
                rows = extract_national(key, adapter, original, fetch(base["url"]))
                source = dict(old)
                if rows != old_rows or source["reviewBy"] < day.isoformat():
                    source["checked"] = day.isoformat()
                if rows != old_rows or source["reviewBy"] <= (day + timedelta(days=7)).isoformat():
                    source["reviewBy"] = (day + timedelta(days=21)).isoformat()
                return key, source, rows, None
            try:
                observed = fingerprint(base["url"])
            except ValueError as error:
                raise OSError("Publisher document unavailable") from error
            if observed != pin:
                raise SourceChanged("Changed source without an unambiguous mapping")
            restored = dict(base, importBase=baseline)
            if old["reviewBy"] != base["reviewBy"]:
                restored["checked"] = day.isoformat()
            else:
                restored["checked"] = old["checked"]
            return key, restored, original, None
        except (ValueError, LookupError, TypeError) as error:
            # Keep the last measured values available for earlier fishing dates only.
            end = min(old["reviewBy"], (day - timedelta(days=1)).isoformat())
            return key, dict(old, reviewBy=end), old_rows, str(error)
        except (OSError, HTTPException) as error:
            return key, old, old_rows, str(error)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for key, source, rows, error in pool.map(source_update, rules["sources"].items()):
            rules["sources"][key] = source
            groups[key] = rows
            if error:
                issues.append(f"{key}: {error}")
    rules["entries"] = [row for group in groups.values() for row in group]

    for water in catalog["waters"]:
        baseline = hashlib.sha256(encode([water, config["risSpecies"]])).hexdigest()
        old = prior_waters.get(water["id"], {})
        if old.get("risBase") == baseline and old.get("risSince"):
            water["datedRules"] = deepcopy(old.get("datedRules", {}))
            water["risSince"] = old.get("risSince")
        water["risBase"] = baseline
        try:
            records = local_records(fetch(water["source"]), water, config["risSpecies"])
            water["risSince"] = water.get("risSince") or day.isoformat()
            history = water.setdefault("datedRules", {})
            for species in set(config["risSpecies"].values()) | history.keys():
                # The page describes the current edition. Never carry an absent or
                # replaced record forward, or infer conditions between known periods.
                periods = history.get(species, [])
                current = records.get(species)
                retained = []
                for period in periods:
                    if period == current:
                        continue
                    cutoff = min(period["until"], (day - timedelta(days=1)).isoformat())
                    if current:
                        cutoff = min(cutoff, (date.fromisoformat(current["from"]) - timedelta(days=1)).isoformat())
                    if period["from"] <= cutoff:
                        retained.append(dict(period, until=cutoff))
                if current and current not in retained:
                    retained.append(current)
                history[species] = retained
        except (ValueError, LookupError, TypeError) as error:
            water["risSince"] = water.get("risSince") or day.isoformat()
            history = water.setdefault("datedRules", {})
            cutoff = (day - timedelta(days=1)).isoformat()
            for species in config["risSpecies"].values():
                history[species] = [dict(record, until=min(cutoff, record["until"]))
                                    for record in history.get(species, []) if record["from"] <= cutoff]
            issues.append(f'{water["id"]}: {error}')
        except (OSError, HTTPException) as error:
            issues.append(f'{water["id"]}: {error}')
    # Only actual data changes move the edition date. Repeats keep the same signed bytes.
    comparison = dict(prior)
    last = comparison.pop("updated", None)
    if rules != comparison or catalog != json.loads(previous.get("catalog.json", "{}")):
        last = day.isoformat()
    if last:
        rules["updated"] = last
    return {"catalog.json": encode(catalog).decode(), "europe-rules.json": encode(rules).decode()}, issues


def collect(folder, previous, day):
    bundled = {name: (release["ASSETS"] / name).read_text() for name in ("catalog.json", "europe-rules.json")}
    rules, issues = refresh_rules(bundled, previous, day)
    folder.mkdir(parents=True, exist_ok=True)
    data = encode(rules)
    (folder / "rules.json").write_bytes(data)
    for issue in issues:
        print("Rule source requires attention:", issue, file=sys.stderr)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as report:
            report.write("## Fishing rule update\n\n")
            if issues:
                report.write("Sources with exceptions in this edition\n\n")
                for issue in issues:
                    key, _, reason = issue.partition(": ")
                    report.write(f"- `{key}` {reason.splitlines()[0]}\n")
            else:
                report.write("All automatically monitored sources completed.\n")
    print(hashlib.sha256(data).hexdigest())


def apply(folder, rule_file, expected_digest):
    # The separate read-only rules job attests to its exact output via a workflow job output.
    if rule_file.is_symlink() or not 0 < rule_file.stat().st_size <= 4 * 1024 * 1024:
        raise ValueError("Invalid rule artifact")
    data = rule_file.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_digest:
        raise ValueError("Rule artifact digest mismatch")
    rules = json.loads(data)
    if set(rules) != {"catalog.json", "europe-rules.json"}:
        raise ValueError("Unexpected rule files")
    atlas = validate(folder)
    atlas["anglingRules"] = rules
    release["write_edition"](atlas, folder, folder)
    validate(folder, expected_rules=rules)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    collect_args = commands.add_parser("collect")
    collect_args.add_argument("output", type=Path)
    collect_args.add_argument("previous", type=Path)
    apply_args = commands.add_parser("apply")
    apply_args.add_argument("candidate", type=Path)
    apply_args.add_argument("rules", type=Path)
    apply_args.add_argument("digest")
    args = parser.parse_args()
    if args.operation == "collect":
        collect(args.output, previous_rules(args.previous), date.today())
    else:
        apply(args.candidate, args.rules, args.digest)
