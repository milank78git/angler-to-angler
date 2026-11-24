"""Render the Supabase Auth template bodies and subjects for the deployment dashboard."""
import argparse
import html
import json
import re
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "supabase/templates"
TOKEN = re.compile(r"\[\[(\w+)\]\]")
# Accounts created before locale metadata was recorded received Czech mail.
CZECH = '{{ if or (not .Data.locale) (eq .Data.locale "cs") }}'


def generate(output):
    layout = (SOURCE / "message.html").read_text()
    languages = {code: json.loads((SOURCE / f"{code}.json").read_text()) for code in ("en", "cs")}
    output.mkdir(parents=True, exist_ok=True)
    for template in ("confirmation", "recovery", "magic_link"):
        def localized(key, markup=True):
            values = []
            for code in ("cs", "en"):
                terms = languages[code]
                value = code if key == "locale" else terms[key if key in terms else template + "." + key]
                if not value.strip() or "{{" in value or "}}" in value:
                    raise ValueError(f"Invalid {code} email message {key}")
                values.append(html.escape(value) if markup else value)
            return CZECH + values[0] + "{{ else }}" + values[1] + "{{ end }}"

        body = TOKEN.sub(lambda match: localized(match[1]), layout)
        subject = localized("title", False) + " · " + localized("brand", False)
        (output / f"{template}.html").write_text(body)
        (output / f"{template}.subject.txt").write_text(subject + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    generate(parser.parse_args().output)
