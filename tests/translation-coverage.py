"""Verify that dropping a language cannot pass the release dictionary check."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "scripts/index-translations.py"
spec = importlib.util.spec_from_file_location("translations", source)
translations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(translations)


class LocaleRegistryTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.assets = self.root / "app/src/main/assets"
        self.assets.mkdir(parents=True)
        self.android = self.root / "app/src/main/res/xml/locales_config.xml"
        self.android.parent.mkdir(parents=True)
        self.enterContext(patch.multiple(translations, ROOT=self.root, ASSETS=self.assets))
        self.registry(["br", "en"], ["br", "en"])
        for locale in ("br", "en"):
            (self.assets / f"strings-{locale}.json").write_text("{}")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-qm", "Base")

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True)

    def registry(self, picker, android):
        (self.assets / "ui-locales.json").write_text(json.dumps(picker))
        tags = "".join(f'<locale android:name="{tag}"/>' for tag in android)
        self.android.write_text('<locale-config xmlns:android="http://schemas.android.com/apk/res/android">'
                                + tags + '</locale-config>')

    def validate(self):
        translations.registered_locales(sorted(self.assets.glob("strings-*.json")), "HEAD")

    def test_complete_removal_fails_against_release(self):
        (self.assets / "strings-br.json").unlink()
        self.registry(["en"], ["en"])
        with self.assertRaisesRegex(ValueError, "Previously shipped languages removed.*br"):
            self.validate()

    def test_missing_android_entry_fails(self):
        self.registry(["br", "en"], ["en"])
        with self.assertRaisesRegex(ValueError, "Android locales_config.xml"):
            self.validate()

    def test_new_regional_dictionary_can_be_added(self):
        (self.assets / "strings-en-gb.json").write_text("{}")
        self.registry(["br", "en", "en-gb"], ["br", "en", "en-GB"])
        self.validate()


if __name__ == "__main__":
    unittest.main()
