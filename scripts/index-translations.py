"""Validate offline UI dictionaries, message references and English-only application sources."""
import argparse
import ast
import json
import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
MESSAGE_ID = re.compile(r"[a-z][a-z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+")
PLACEHOLDER = re.compile(r"\{[a-z][a-zA-Z0-9_]*\}")
CZECH_LETTERS = re.compile(r"[\u00e1\u010d\u010f\u00e9\u011b\u00ed\u0148\u00f3\u0159\u0161\u0165\u00fa\u016f\u00fd\u017e]", re.I)
LITERAL = r"""('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")"""
BILINGUAL = re.compile(r"\b(?:t|tr|translate|words|text)\(\s*" + LITERAL + r"\s*,\s*" + LITERAL)
CODE_TYPES = {".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".java", ".kt", ".kts", ".py",
              ".css", ".html", ".xml", ".go", ".gradle", ".sh", ".sql", ".yml", ".yaml"}
# Applied database seeds include official water names and historic species search aliases.
DATA_MIGRATIONS = {"20261123180057_public_catch_cards.sql", "20261124004714_european_market_directory.sql",
                   "20261124050000_czech_waters.sql", "20261124060100_european_water_seed.sql"}

WRONG_FISHING_TERMS = {
    "lt": r"\bangela(?:s|i|ms|is)?\b", "sq": r"\bengj\u00ebll\w*",
    "tr": r"\bmelek\w*", "br": r"\banjel\b", "et": r"\b(?:ingel|ingli|inglit|inglid|ingleid)\b",
    "bs": r"\bangel[ai]\b", "hr": r"\bangel[ai]\b", "sl": r"\bangel[ai]\b",
    "sr": r"\bанђел\w*",
    "ru": r"\bангел", "it": r"\bangel[io]\b", "el": r"\b[αά]γγ[εέ]λ",
    "da": r"\b(?:engel|engle|engelskere)", "no": r"\b(?:engel|engle|engelskmenn)",
}

MISTRANSLATIONS = {
    ("fr", "catch_form.this_photo_has_a_location_fix_after"): r"\b[\u00e9e]pargne\b",
    ("fr", "messages.the_contents_of_the_retried_request_have"): r"\bdemande de retrait\b",
    ("et", "help-topics.profile.steps.1"): r"\b(?:publish switch|inglers|direktiivis)\b",
}


def unique(entries):
    result = {}
    for key, value in entries:
        if key in result:
            raise ValueError(f"Duplicate key {key!r}")
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


def rule_numbers(text):
    return sorted(int(n) for n in re.findall(r"\d+", text))


def repeated_phrase(value):
    """Find four consecutive copies of the same word or short phrase."""
    words = re.findall(r"[^\W\d_]+", value.casefold())
    for size in range(1, min(7, len(words) // 4) + 1):
        for start in range(len(words) - 4 * size + 1):
            phrase = words[start:start + size]
            if phrase * 4 == words[start:start + 4 * size]:
                return " ".join(phrase)
    return None


def prior_json(ref, path):
    if not ref:
        return None
    name = path.relative_to(ROOT).as_posix()
    spec = f"{ref}:{name}"
    if subprocess.run(["git", "cat-file", "-e", spec], cwd=ROOT, stderr=subprocess.DEVNULL).returncode:
        return None
    return json.loads(subprocess.check_output(["git", "show", spec], cwd=ROOT))


def registered_locales(packs, against):
    """Cross-check the app picker, Android system settings and the previous shipped set."""
    manifest = ASSETS / "ui-locales.json"
    locales = read(manifest)
    if locales != sorted(p.stem[8:] for p in packs):
        raise ValueError("Update ui-locales.json to match the packaged dictionaries")
    android = ElementTree.parse(ROOT / "app/src/main/res/xml/locales_config.xml")
    android_locales = [item.attrib["{http://schemas.android.com/apk/res/android}name"]
                       for item in android.getroot().findall("locale")]
    if sorted(tag.lower() for tag in android_locales) != locales:
        raise ValueError("Android locales_config.xml and ui-locales.json must expose the same languages")
    if against:
        old_locales = prior_json(against, manifest)
        if old_locales is not None:
            removed = set(old_locales) - set(locales)
            if removed:
                raise ValueError(f"Previously shipped languages removed: {sorted(removed)}")


def validate_guide(locale, entries, english, guide_keys, guide_steps, hint_keys):
    # A regional override may supply just the differences from its base language.
    if "-" not in locale:
        missing = guide_keys - entries.keys()
        if missing:
            raise ValueError(f"{locale}: missing help translations: {sorted(missing)}")
    if locale == "en" or locale.startswith("en-"):
        return
    for key in (guide_steps | hint_keys) & entries.keys():
        if len(english[key]) >= 45 and " ".join(entries[key].split()) == " ".join(english[key].split()):
            raise ValueError(f"{locale}: English source copied into localized help: {key}")


def check(show_coverage=False, against=None):
    english = read(ASSETS / "strings-en.json")
    czech = read(ASSETS / "strings-cs.json")
    fully_translated = {
        "an", "ast", "az", "be", "bg", "bs", "ca", "cs", "cy", "da", "de", "el",
        "en", "es", "et", "eu", "fi", "fr", "fy", "ga", "gl", "hr", "hu", "hy",
        "is", "it", "lb", "lt", "lv", "mk", "mt", "nl", "nn", "no", "oc", "pl", "pt",
        "ro", "ru", "sco", "sk", "sl", "sq", "sr", "sv", "tr", "uk",
    }
    guide = read(ASSETS / "help-topics.json")
    guide_keys = {key for chapter in guide.values() for key in [chapter["title"], *chapter["steps"]]}
    guide_steps = {key for chapter in guide.values() for key in chapter["steps"]}
    hint_keys = {entry["message"] for entry in read(ASSETS / "field-hints.json").values()}
    complete_guides = complete_hints = 0
    missing_total = 0
    complete = 0
    packs = sorted(ASSETS.glob("strings-*.json"))
    if against:
        subprocess.run(["git", "rev-parse", "--verify", f"{against}^{{commit}}"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    registered_locales(packs, against)
    for p in packs:
        entries = read(p)
        locale = p.stem[8:]
        previous = prior_json(against, p) or {}
        removed = (previous.keys() & english.keys()) - entries.keys()
        if removed:
            raise ValueError(f"{p.name}: existing translations removed: {sorted(removed)}")
        missing = english.keys() - entries.keys()
        if missing and p.stem[8:] in fully_translated:
            raise ValueError(f"{p.name}: missing {len(missing)} messages: {sorted(missing)[:8]}")
        validate_guide(locale, entries, english, guide_keys, guide_steps, hint_keys)
        guide_count = len(guide_keys & entries.keys())
        hint_count = len(hint_keys & entries.keys())
        complete_guides += guide_count == len(guide_keys)
        complete_hints += hint_count == len(hint_keys)
        if show_coverage:
            print(f"{locale:4} {len(entries):4}/{len(english)} messages, "
                  f"{guide_count}/{len(guide_keys)} help titles and steps, {hint_count}/{len(hint_keys)} field hints")
        missing_total += len(missing)
        complete += not missing
        for key, value in entries.items():
            if key not in english or not MESSAGE_ID.fullmatch(key) or not isinstance(value, str) or not value.strip():
                raise ValueError(f"{p.name}: invalid message {key!r}")
            if re.search(r"<(?:[A-Za-z/!?])", value):
                raise ValueError(f"{p.name}: UI labels must be plain text: {key}")
            source = english[key]
            if (source[0].isspace() and not value[0].isspace()
                    or source[-1].isspace() and not value[-1].isspace()):
                raise ValueError(f"{p.name}: missing separator for concatenated text in {key}")
            phrase = repeated_phrase(value)
            if phrase:
                raise ValueError(f"{p.name}: repeated phrase {phrase!r} in {key}")
            if "angler" in source.lower() and re.search(
                r"\b(?:signed[- ]in angels?|the angel who asked|englishers|englishmen)\b", value, re.I
            ):
                raise ValueError(f"{p.name}: incorrect angling term in {key}")
            if key == "help-topics.catch.steps.2":
                misleading_terms = {
                    "es": r"\b(?:angular|picadura)\b", "de": r"\b(?:des Angels|Bitterung)\b",
                    "sk": r"\bpriamozdan", "kw": r"\bangel\b",
                }
                if locale in misleading_terms and re.search(misleading_terms[locale], value, re.I):
                    raise ValueError(f"{p.name}: incorrect fishing position or bite in {key}")
            if p.stem == "strings-fr" and re.search(r"\bla (?:place de la )?bite\b", value, re.I):
                raise ValueError(f"{p.name}: incorrect fishing terminology for {key}")
            if "angler" in source.lower():
                pattern = WRONG_FISHING_TERMS.get(locale)
                if pattern and re.search(pattern, value, re.I):
                    raise ValueError(f"{p.name}: incorrect translation of angler for {key}")
            pattern = MISTRANSLATIONS.get((locale, key))
            if pattern and re.search(pattern, value, re.I):
                raise ValueError(f"{p.name}: incorrect meaning in {key}")
            if re.search(r"\b(?:brazzers|pornhub)\b", value, flags=re.IGNORECASE):
                raise ValueError(f"{p.name}: unrelated adult-site text in the translation for {key}")
            if re.search(r"\u2047|\bQShortcut\b|^@\s*(?:info|title|action|item)\b|[A-Za-z]+\.\s*kgm\b", value):
                raise ValueError(f"{p.name}: unrelated translation metadata in {key}")
            if re.search(r"([^\W\d_])\1{7,}", value, flags=re.IGNORECASE):
                raise ValueError(f"{p.name}: repeated letters in the translation for {key}")
            if key.startswith("europe-rules.scopes."):
                # Dates, sizes, area numbers and legal references carry the scope of a rule.
                if rule_numbers(value) != rule_numbers(english[key]):
                    raise ValueError(f"{p.name}: fishery rule numbers differ for {key}")
            if key == "europe-rules.scopes.delocal" and "D/E/R/W" not in value:
                raise ValueError(f"{p.name}: keep the official D/E/R/W basin codes for {key}")
            if sorted(PLACEHOLDER.findall(value)) != sorted(PLACEHOLDER.findall(english[key])):
                raise ValueError(f"{p.name}: placeholders differ for {key}")

    def reference(value, path):
        if value not in english:
            raise ValueError(f"{path}: unknown message ID {value!r}")

    for chapter in guide.values():
        for key in [chapter["title"], *chapter["steps"]]:
            reference(key, "help-topics.json")

    def data_keys(node, path):
        if isinstance(node, dict):
            if "cs" in node or "en" in node:
                raise ValueError(f"{path}: localized UI copy belongs in dictionaries")
            if "message" in node:
                reference(node["message"], path)
            for value in node.values():
                data_keys(value, path)
        elif isinstance(node, list):
            for item in node:
                data_keys(item, path)

    for name in ("catalog.json", "europe-rules.json", "field-hints.json"):
        data_keys(read(ASSETS / name), name)

    # Catch unaccented Czech labels too, while allowing identical English words and standard codes.
    untranslated = {v for v in czech.values() if v.isascii() and v.isalpha() and len(v) > 2} - set(english.values())
    paths = subprocess.check_output(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    for name in paths:
        path = ROOT / name
        if path.suffix not in CODE_TYPES or not path.is_file():
            continue
        if ("supabase/migrations/" in name and path.name in DATA_MIGRATIONS
                or re.fullmatch(r"app/src/main/res/values-[^/]+/strings\.xml", name)):
            continue
        source = path.read_text()
        for i, line in enumerate(source.splitlines(), 1):
            if CZECH_LETTERS.search(line):
                raise ValueError(f"{name}:{i}: move localized text to a language or provider dictionary")
        if path.suffix not in {".js", ".cjs", ".ts", ".tsx", ".jsx", ".mjs", ".java", ".kt"}:
            continue
        if BILINGUAL.search(source):
            raise ValueError(f"{name}: use one English message ID per translation lookup")
        for match in re.finditer(LITERAL, source):
            if match[1][1:-1] in untranslated:
                raise ValueError(f"{name}: inline localized label {match[1]}")
        if path.suffix in {".js", ".ts", ".tsx", ".jsx", ".mjs"}:
            lookup = r"(?<!\.)\b(?:t|words|label)\("
        elif "android-smoke/" in name:
            lookup = r"\b(?:tr|label)\("
        elif path.stem in {"AccountActivity", "WaterSettingsActivity", "GroupsActivity"}:
            lookup = r"(?<!\.)\b(?:text|t)\("
        else:
            lookup = r"\bAppLanguage\.text\(\s*\w+,\s*"
        for match in re.finditer(lookup + r"\s*" + LITERAL + r"\s*\)", source):
            reference(ast.literal_eval(match[1]), name)
    print(f"Complete help chapters: {complete_guides}/{len(packs)} languages. "
          f"Complete field hints: {complete_hints}/{len(packs)} languages.")
    print(f"Validated {len(english)} message IDs. {complete}/{len(packs)} dictionaries have every key. "
          f"{missing_total} localized messages are missing in total.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate without modifying any resources (default)")
    parser.add_argument("--coverage", action="store_true", help="Also list coverage for every packaged locale")
    parser.add_argument("--against", metavar="REF", help="Reject loss of existing translations against a Git commit")
    args = parser.parse_args()
    check(args.coverage, args.against)
