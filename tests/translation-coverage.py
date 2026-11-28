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


class GuideContentTest(unittest.TestCase):
    steps = {"atlas.help"}
    titles = {"help-topics.waters.title"}
    hints = {"field-hints.fish"}
    english = {
        "atlas.help": "The online map provider receives the map extent and device IP address.",
        "help-topics.waters.title": "Waters",
        "field-hints.fish": "Choose a fish from the list or enter the species name yourself.",
    }

    def validate(self, locale, entries):
        translations.validate_guide(locale, entries, self.english, self.titles | self.steps, self.steps, self.hints)

    def test_base_language_requires_every_title_and_step_including_shared_steps(self):
        with self.assertRaisesRegex(ValueError, "missing help translations.*atlas.help"):
            self.validate("br", {"help-topics.waters.title": "Dour"})

    def test_partially_translated_paragraph_is_detected(self):
        key = "field-hints.fish"
        mixed = {key: "Wahl: Choose a fish from the list. Dann bestaetigen."}
        with self.assertRaisesRegex(ValueError, "untranslated English phrase"):
            self.validate("de-at", mixed)

    def test_base_language_requires_contextual_field_hints(self):
        entries = {"atlas.help": "Karte", "help-topics.waters.title": "Wasser"}
        with self.assertRaisesRegex(ValueError, "missing help translations.*field-hints.fish"):
            self.validate("de", entries)

    def test_numeric_range_includes_the_negative_bound(self):
        source = {"field-hints.lat": "Latitude from -90 to 90"}
        with self.assertRaisesRegex(ValueError, "missing negative coordinate bound"):
            translations.validate_guide("fr", {"field-hints.lat": "Latitude de 90 a 90"},
                                        source, set(), set(), source.keys())

    def test_map_provider_or_ip_cannot_disappear(self):
        key = "atlas.help"
        source = {key: "openmaps.fr, CUZK and EOX receive the IP address."}
        for name in ("openmaps.fr", "CUZK", "EOX", "IP"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "missing map provider or IP"):
                translations.validate_guide("de", {key: source[key].replace(name, "")},
                                            source, {key}, {key}, set())

    def test_region_may_inherit_steps_but_an_english_copy_is_still_rejected(self):
        self.validate("fr-ca", {})
        self.validate("en-gb", self.english)
        for key in self.steps | self.hints:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "English source copied"):
                self.validate("fr-ca", {key: self.english[key].replace(" ", "  ")})


if __name__ == "__main__":
    unittest.main()
