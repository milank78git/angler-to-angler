"""Recompute the bounded mobile artefact and its registry on the publication runner."""
from datetime import date
import gzip
import hashlib
import io
import json
from pathlib import Path
import runpy
import sys

release = runpy.run_path(str(Path(__file__).with_name("water-release.py")))


def geometry(value, depth):
    if not isinstance(value, list):
        raise ValueError("Invalid geometry")
    if depth:
        for item in value:
            geometry(item, depth - 1)
    elif (len(value) != 2 or any(type(x) not in (float, int) for x in value)
            or not (-180 <= value[0] <= 180 and -90 <= value[1] <= 90)):
        raise ValueError("Invalid geographic coordinate")


def validate_edition(edition, czech=False):
    if set(edition) != {"asOf", "waters"} or not isinstance(edition["waters"], list) or not edition["waters"]:
        raise ValueError("Invalid provider edition")
    required = {"id", "number", "provider", "slug", "name"} if czech else {"code", "name"}
    labels = required | {"area", "region", "manager", "kind", "status", "number"}
    for row in edition["waters"]:
        if not required <= row.keys() or not row["name"]:
            raise ValueError("Incomplete fishery")
        for field, value in row.items():
            if field in labels:
                if not isinstance(value, str) or len(value) > 1500 or any(ord(c) < 32 for c in value):
                    raise ValueError("Invalid fishery label")
            elif field in ("points", "lines", "outline"):
                geometry(value, {"points":1, "lines":2, "outline":3}[field])
            elif czech and field in ("acreage", "length") and type(value) in (float, int) and value >= 0:
                continue
            elif czech and field in ("trout", "mapped") and type(value) is bool:
                continue
            else:
                raise ValueError("Unexpected fishery field: " + field)


def validate(folder, expected_rules=None):
    def bounded(name, limit):
        path = folder / name
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
            raise ValueError("Invalid atlas file: " + name)
        return path.read_bytes()

    manifest = json.loads(bounded("manifest.json", 8192))
    packed = bounded("atlas.json.gz", 16 * 1024**2)
    registry = bounded("registry.json", 16 * 1024**2)
    with gzip.GzipFile(fileobj=io.BytesIO(packed)) as archive:
        raw = archive.read(48 * 1024**2 + 1)
    if len(raw) > 48 * 1024**2:
        raise ValueError("Oversized atlas")
    atlas = json.loads(raw)
    if set(atlas) != {"format", "cz", "shapes", "europe", "sources", "anglingRules"} or atlas["format"] != 1:
        raise ValueError("Invalid atlas sections")
    assets = release["ASSETS"]
    approved = expected_rules or {key: (assets / key).read_text() for key in ("catalog.json", "europe-rules.json")}
    sources = release["read"](assets / "water-sources.json")
    sources["providers"].update(release["read"](release["ROOT"] / "data/europe/water-providers.json"))
    sources["providers"] = {key: sources["providers"][key] for key in atlas["europe"]}
    if atlas["anglingRules"] != approved or atlas["sources"] != sources or not isinstance(atlas["shapes"], dict):
        raise ValueError("Unapproved rules or provider definitions")
    validate_edition(atlas["cz"], czech=True)
    for edition in atlas["europe"].values():
        validate_edition(edition)
    for shape in atlas["shapes"].values():
        geometry(shape, 3)
    if release["encode"](release["registry"](atlas)) != registry:
        raise ValueError("Registry differs from the atlas")
    dates = [date.fromisoformat(e["asOf"]) for e in [atlas["cz"], *atlas["europe"].values()]]
    edition = date.fromisoformat(release["edition_date"](atlas))
    if max(dates + [edition]) > date.today() or manifest != dict(format=1, asOf=edition.isoformat(),
            bytes=len(packed), unpacked=len(raw), sha256=hashlib.sha256(packed).hexdigest(),
            registrySha256=hashlib.sha256(registry).hexdigest()):
        raise ValueError("Manifest differs from the artefact")
    return atlas


if __name__ == "__main__":
    validate(Path(sys.argv[1]))
