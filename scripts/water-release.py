"""Build deterministic atlas releases. Reuse the last successful edition of an unavailable source."""
import argparse
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"


def read(path):
    return json.loads(path.read_bytes())


def encode(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def bundled():
    return {"format": 1, "cz": read(ASSETS / "czech-waters.json"), "shapes": read(ASSETS / "czech-water-shapes.json"),
            "europe": read(ASSETS / "europe-waters.json"), "sources": read(ASSETS / "water-sources.json")}


def registry(atlas):
    rows = [[w["id"], w["name"] + " · " + re.sub(r"^(\d{3})(\d{3})(?=/|$)", r"\1 \2", w["number"]), "Europe/Prague"]
            for w in atlas["cz"]["waters"] if w["id"] not in ("CZ:401001", "CZ:401009")]
    for provider, edition in atlas["europe"].items():
        meta = atlas["sources"]["providers"][provider]
        for w in edition["waters"]:
            rows.append([meta["country"] + ":" + provider + ":" + w["code"], w["name"] +
                         (" · " + w["number"] if w.get("number") else ""), meta["zone"]])
    if not rows or len({row[0] for row in rows}) != len(rows):
        raise ValueError("Empty directory or duplicate identity")
    return sorted(rows)


def validate_size(rows, previous):
    # A valid-looking partial export should retain the last edition until its scope is reviewed.
    if not rows or (len(previous) >= 20 and len(rows) < 0.75 * len(previous)):
        raise ValueError("Unexpectedly incomplete source edition")


def run_import(script, *args):
    subprocess.run([sys.executable, str(ROOT / "scripts" / script), *map(str, args)], check=True)


def build(output, cache, stamp, refresh):
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    previous = output / "atlas.json.gz"
    atlas = json.loads(gzip.decompress(previous.read_bytes())) if previous.exists() else bundled()
    sources = read(ASSETS / "water-sources.json")
    # Additional providers are distributed as data. A new country does not require a new APK.
    sources["providers"].update(read(ROOT / "data/europe/water-providers.json"))
    failures = []
    if refresh:
        try:
            staged = cache / "cz-edition"
            run_import("import-czech-waters.py", cache / "cz", "--download", "--as-of", stamp, "--output", staged)
            new = read(staged / "czech-waters.json")
            shapes = read(staged / "czech-water-shapes.json")
            validate_size(new["waters"], atlas["cz"]["waters"])
            if new["waters"] != atlas["cz"]["waters"] or shapes != atlas["shapes"]:
                atlas["cz"], atlas["shapes"] = new, shapes
        except (ValueError, OSError, subprocess.SubprocessError) as err:
            failures.append("CZ: " + str(err))
        for key in sources["providers"]:
            try:
                path = cache / (key + ".json")
                extra = []
                if key == "FVO" and key in atlas["europe"]:
                    reference = cache / "previous-FVO.json"
                    reference.write_bytes(encode(atlas["europe"][key]))
                    extra = ["--previous", reference]
                run_import("import-europe-waters.py", key, path, "--as-of", stamp, *extra)
                new = read(path)
                old = atlas["europe"].get(key, {}).get("waters", [])
                validate_size(new["waters"], old)
                if new["waters"] != old:
                    atlas["europe"][key] = new
            except (ValueError, OSError, subprocess.SubprocessError) as err:
                failures.append(key + ": " + str(err))
    # A new provider with a checked-in baseline remains usable during its first upstream outage.
    baseline = read(ASSETS / "europe-waters.json")
    editions = {**baseline, **atlas["europe"]}
    atlas["europe"] = {k: editions[k] for k in sources["providers"] if k in editions}
    sources["providers"] = {k: sources["providers"][k] for k in atlas["europe"]}
    atlas["sources"] = sources
    atlas["anglingRules"] = {name: (ASSETS / name).read_text() for name in ("catalog.json", "europe-rules.json")}
    raw = encode(atlas)
    if len(raw) > 48 * 1024 * 1024:
        raise ValueError("Atlas exceeds mobile unpacking limit")
    pack = gzip.compress(raw, compresslevel=9, mtime=0)
    if len(pack) > 16 * 1024 * 1024:
        raise ValueError("Atlas exceeds mobile download limit")
    keys = encode(registry(atlas))
    previous.write_bytes(pack)
    (output / "registry.json").write_bytes(keys)
    dates = [atlas["cz"]["asOf"], *(e["asOf"] for e in atlas["europe"].values())]
    manifest = {"format": 1, "asOf": max(dates), "bytes": len(pack), "unpacked": len(raw),
                "sha256": hashlib.sha256(pack).hexdigest(), "registrySha256": hashlib.sha256(keys).hexdigest()}
    (cache / "manifest.json").write_bytes(encode(manifest))
    (cache / "failed-sources.txt").write_text("\n".join(failures))
    for failure in failures:
        print("::warning::Keeping the previous edition for " + failure)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("output", type=Path)
    p.add_argument("cache", type=Path)
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--as-of", type=date.fromisoformat, required=True)
    args = p.parse_args()
    build(args.output, args.cache, args.as_of.isoformat(), args.refresh)
