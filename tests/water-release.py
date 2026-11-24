"""Exercise the same release builder as the daily workflow, including isolated failures."""
import gzip
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
release = runpy.run_path(str(root / "scripts/water-release.py"))
build = release["build"]


class WaterReleaseTest(unittest.TestCase):
    def test_offline_rebuild_and_partial_upstream_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            output, cache = Path(folder) / "out", Path(folder) / "cache"
            build(output, cache, "2026-11-24", False)
            archive = output / "atlas.json.gz"
            first = archive.read_bytes()
            base = json.loads(gzip.decompress(first))
            build(output, cache, "2026-11-25", False)
            self.assertEqual(archive.read_bytes(), first)
            def import_one(script, *args):
                if args[0] != "IFI":
                    raise OSError("test upstream unavailable")
                edition = base["europe"]["IFI"]
                edition["waters"][0]["name"] += " changed"
                edition["asOf"] = "2026-11-25"
                args[1].write_text(json.dumps(edition))
            with patch.dict(build.__globals__, {"run_import": import_one}):
                build(output, cache, "2026-11-25", True)
            updated = json.loads(gzip.decompress(archive.read_bytes()))
            self.assertEqual(updated, base)
            self.assertNotEqual(archive.read_bytes(), first)
            self.assertIn("SRZ:", (cache / "failed-sources.txt").read_text())
            self.assertEqual(release["read"](cache / "manifest.json")["bytes"], archive.stat().st_size)
            targets = release["read"](output / "registry.json")
            self.assertEqual(len({row[0] for row in targets}), len(targets))
            self.assertTrue(any("changed" in row[1] for row in targets))


if __name__ == "__main__":
    unittest.main()
