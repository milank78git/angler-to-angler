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

    def test_new_provider_is_announced_only_after_its_first_complete_import(self):
        with tempfile.TemporaryDirectory() as folder:
            output, cache = Path(folder) / "out", Path(folder) / "cache"
            def refresh(script, provider, *args):
                if provider != "CYL":
                    raise OSError("offline")
                args[0].write_text(json.dumps({"asOf":"2026-11-24","waters":[
                    {"code":"42","number":"AV-1","name":"Aravalle","lines":[[[-5.59,40.3],[-5.58,40.31]]]}
                ]}))
            with patch.dict(build.__globals__, {"run_import": refresh}):
                build(output, cache, "2026-11-24", True)
            atlas = json.loads(gzip.decompress((output / "atlas.json.gz").read_bytes()))
            self.assertIn("CYL", atlas["sources"]["providers"])
            self.assertNotIn("ZH", atlas["sources"]["providers"])
            self.assertIn(["ES:CYL:42","Aravalle · AV-1","Europe/Madrid"],release["read"](output / "registry.json"))
            def unavailable(*args):
                raise OSError("offline")
            with patch.dict(build.__globals__, {"run_import": unavailable}):
                build(output, cache, "2026-11-25", True)
            self.assertEqual(atlas,json.loads(gzip.decompress((output / "atlas.json.gz").read_bytes())))


if __name__ == "__main__":
    unittest.main()
