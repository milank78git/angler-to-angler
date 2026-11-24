"""Build paste-ready Supabase Auth bodies and subjects from the email language packs."""
import argparse
import html
import json
import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "supabase/templates"
TOKEN = re.compile(r"\[\[(\w+)\]\]")
# Preserve the language of messages for accounts registered before locale metadata existed.
LOCALE = '{{ $locale := or .Data.locale "cs" }}'


def select(versions):
    """Go templates select the most specific published language, with English as the fallback."""
    result = LOCALE
    codes = sorted(versions.keys() - {"en"}, key=len, reverse=True)
    for i, code in enumerate(codes):
        branch = "if" if i == 0 else "else if"
        prefix = f'(eq (printf "%.{len(code) + 1}s" $locale) "{code}-")'
        result += "{{ " + branch + f' or (eq $locale "{code}") {prefix}' + " }}" + versions[code]
    return result + ("{{ else }}" if codes else "") + versions["en"] + ("{{ end }}" if codes else "")


def generate(output):
    layout = (SOURCE / "message.html").read_text()
    packs = {p.stem: json.loads(p.read_text()) for p in SOURCE.glob("*.json")}
    output.mkdir(parents=True, exist_ok=True)
    for template in ("confirmation", "recovery", "magic_link"):
        bodies, subjects = {}, {}
        for code in packs:
            if not re.fullmatch(r"[a-z]{2,3}(?:-[a-z0-9]{2,8})*", code):
                raise ValueError(f"Invalid email locale {code}")
            parts = code.split("-")
            labels = packs["en"].copy()
            for n in range(1, len(parts) + 1):
                labels.update(packs.get("-".join(parts[:n]), {}))

            def message(key):
                value = code if key == "locale" else labels[key if key in labels else template + "." + key]
                if not value.strip() or "{{" in value or "}}" in value:
                    raise ValueError(f"Invalid {code} email message {key}")
                return value

            bodies[code] = TOKEN.sub(lambda match: html.escape(message(match[1])), layout)
            subjects[code] = message("title") + " · " + message("brand")
        (output / f"{template}.html").write_text(select(bodies))
        (output / f"{template}.subject.txt").write_text(select(subjects) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    generate(parser.parse_args().output)
