"""Index static bilingual source messages shared by Android and the offline WebView.

English source strings are dictionary keys. Dynamic messages retain their explicit source fallback.
Use --check in CI to detect stale Czech entries after changing UI or guide text.
"""
from pathlib import Path
import ast
import json
import re
import sys

root = Path(__file__).resolve().parents[1]
assets = root/"app/src/main/assets"
literal = r"""('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")"""
call = re.compile(r"\b(?:t|text|translate|words)\(\s*" + literal + r"\s*,\s*" + literal + r"\s*,?\s*\)", re.S)
messages = {}
for path in sorted([*assets.glob("*.js"), *(root/"app/src/main/java").rglob("*.java")]):
    for match in call.finditer(path.read_text()):
        cs,en = [ast.literal_eval(s) for s in match.groups()]
        if cs and en:
            messages[en]=cs
for file in ("help-topics.json","field-hints.json"):
    path=assets/file
    def add(node):
        if isinstance(node,list):
            for value in node: add(value)
        if isinstance(node,dict):
            if "cs" in node and "en" in node: messages[node["en"]]=node["cs"]
            else:
                for value in node.values(): add(value)
    if path.exists(): add(json.loads(path.read_text()))
# Named messages are authored directly in the locale files, independent of English wording.
named=json.loads((assets/"strings-en.json").read_text())
czech=json.loads((assets/"strings-cs.json").read_text())
for key in named:
    if not czech.get(key): sys.exit("Missing Czech label: "+key)
    messages[key]=czech[key]
result=json.dumps(messages,ensure_ascii=False,sort_keys=True,indent=2)+"\n"
target=assets/"strings-cs.json"
if "--check" in sys.argv:
    if target.read_text()!=result: sys.exit("Rebuild the locale index with scripts/index-translations.py")
else: target.write_text(result)
