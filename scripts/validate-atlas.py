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


def validate(folder):
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
    approved = {key: (assets / key).read_text() for key in ("catalog.json", "europe-rules.json")}
    sources = release["read"](assets / "water-sources.json")
    sources["providers"].update(release["read"](release["ROOT"] / "data/europe/water-providers.json"))
    sources["providers"] = {key: sources["providers"][key] for key in atlas["europe"]}
    if atlas["anglingRules"] != approved or atlas["sources"] != sources or not isinstance(atlas["shapes"], dict):
        raise ValueError("Unapproved rules or provider definitions")
    if release["encode"](release["registry"](atlas)) != registry:
        raise ValueError("Registry differs from the atlas")
    dates = [date.fromisoformat(e["asOf"]) for e in [atlas["cz"], *atlas["europe"].values()]]
    if max(dates) > date.today() or manifest != dict(format=1, asOf=max(dates).isoformat(),
            bytes=len(packed), unpacked=len(raw), sha256=hashlib.sha256(packed).hexdigest(),
            registrySha256=hashlib.sha256(registry).hexdigest()):
        raise ValueError("Manifest differs from the artefact")


if __name__ == "__main__":
    validate(Path(sys.argv[1]))
