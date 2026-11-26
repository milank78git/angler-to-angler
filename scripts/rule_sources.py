"""Read numeric and seasonal changes from recognized authority documents."""
import calendar
from copy import deepcopy
from datetime import date
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


DATA = Path(__file__).resolve().parents[1] / "data/europe/rule-imports.json"


class SourceChanged(ValueError):
    """The publisher returned a document whose meaning cannot be represented reliably."""


class Article(HTMLParser):
    """Read a single official article independently of menus and page furniture."""

    def __init__(self, css_class):
        super().__init__()
        self.css_class = css_class
        self.depth = self.count = 0
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag == "div":
            if self.css_class in dict(attrs).get("class", "").split():
                self.count += 1
                self.depth = 1
            elif self.depth:
                self.depth += 1

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1

    def handle_data(self, text):
        if self.depth:
            self.blocks.append(text)

    def extract(self, document):
        self.feed(document)
        self.close()
        if self.count != 1 or self.depth:
            raise SourceChanged("Missing or incomplete authority article")
        return " ".join(" ".join(self.blocks).split())


def fetch_html(url):
    """Read the allowlisted publisher over TLS with a bounded response."""
    request = Request(url, headers={"User-Agent": "AnglerToAngler/1.0 rule updates"})
    with urlopen(request, timeout=20) as response:
        final = urlsplit(response.geturl())
        if final.scheme != "https" or final.hostname != urlsplit(url).hostname:
            raise OSError("Unexpected publisher redirect")
        if response.headers.get_content_type() != "text/html":
            raise OSError("Unexpected publisher response")
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise OSError("Oversized publisher response")
        text = raw.decode(response.headers.get_content_charset() or "utf-8")
        if re.search(r"<title>\s*(Just a moment|Access denied|Checking your browser)", text, re.I):
            raise OSError("Publisher requires interactive access")
        return text


def month_day(day, month, months):
    return date(2000, months.index(month) + 1, int(day)).strftime("%m-%d")


def extract_national(key, definition, rows, document):
    """Match the entire article; only the fields captured by its adapter may change."""
    article = Article(definition["articleClass"]).extract(document)
    rows = deepcopy(rows)

    if key == "cz11":
        sections = re.split(r"(?=\([23]\) )", article)
        if len(sections) != 3:
            raise SourceChanged("Unexpected size-limit sections")
        pattern = r"\(([A-Z][a-z]+ [a-z]+)\)\s+(\d{1,3}) cm"
        tables = []
        for section in sections[1:]:
            matches = re.findall(pattern, section)
            table = {latin: int(size) for latin, size in matches}
            if len(table) != len(matches) or any(n <= 0 for n in table.values()):
                raise SourceChanged("Duplicate species or invalid length")
            tables.append(table)
        article = re.sub(pattern, r"(\1) # cm", article)
        updated = []
        for row in rows:
            latin, = row["species"]
            if latin in tables[0] and tables[0].get(latin) == tables[1].get(latin):
                updated.append(dict(row, scope="czall", minCm=tables[0].pop(latin)))
                tables[1].pop(latin)
                continue
            for scope, table in zip(("nontrout", "cztrout"), tables):
                if latin in table:
                    updated.append(dict(row, scope=scope, minCm=table.pop(latin)))
        if any(tables):
            raise SourceChanged("Unmapped species")
        rows = updated
    elif key == "cz13":
        pattern = r"\((\d+)\) Od (\d{1,2})\. (\w+) do (\d{1,2})\. (\w+)"
        sections = {}
        for number, d1, m1, d2, m2 in re.findall(pattern, article):
            sections[number] = [month_day(d1, m1, definition["months"]),
                                month_day(d2, m2, definition["months"])]
        article = re.sub(pattern, r"(\1) Od # do #", article)
        for row in rows:
            selector = row["species"][0] if row["species"] else "allFreshwater"
            row["closed"] = sections[definition["paragraphs"][selector]]
    elif key == "gb":
        pattern = r"(\d{1,2}) ([A-Z][a-z]+) to (\d{1,2}) ([A-Z][a-z]+)"
        matches = re.findall(pattern, article)
        if len(matches) != 2 or matches[0] != matches[1]:
            raise SourceChanged("The two published close seasons differ")
        d1, m1, d2, m2 = matches[0]
        months = list(calendar.month_name)[1:]
        rows[0]["closed"] = [month_day(d1, m1, months), month_day(d2, m2, months)]
        article = re.sub(pattern, "# to #", article)
    elif key == "gbsize":
        pattern = r"\b(\d{1,2}) pike \(up to (\d{1,3})cm\)"
        match = re.findall(pattern, article)
        if len(match) != 1 or min(map(int, match[0])) < 1:
            raise SourceChanged("Missing pike catch or length limit")
        rows[0]["daily"], rows[0]["maxCm"] = map(int, match[0])
        article = re.sub(pattern, "# pike (up to #cm)", article)
    else:
        raise ValueError("Unknown rule adapter")

    if hashlib.sha256(article.encode()).hexdigest() != definition["templateSha256"]:
        raise SourceChanged("The article changed outside its supported fields")
    return rows


def local_records(document, water, species_ids):
    """Read dated RIS records for this water without evaluating client-side JavaScript."""
    payload = re.findall(r'<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>(.*?)</script>', document, re.S)
    if len(payload) != 1:
        raise SourceChanged("RIS did not supply its data")
    nodes = json.loads(payload[0])

    def value(index):
        if type(index) is not int or not 0 <= index < len(nodes):
            raise SourceChanged("Invalid RIS data reference")
        return nodes[index]

    root = value(value(0)[1])
    if value(root["path"]) != urlsplit(water["source"]).path:
        raise SourceChanged("Wrong fishery identity")
    group, = [item for item in nodes if isinstance(item, dict) and "miryAHajeni" in item]
    records = {}
    for ref in value(group["miryAHajeni"]):
        row = value(ref)
        fish = value(row["druhRyby"])
        key = species_ids.get(str(value(fish["id"])))
        if not key or value(row["platny"]) is not True:
            continue
        known = {"sid", "datumOd", "datumDo", "typReviru", "platny", "druhRyby", "jeHajen", "dolniMira", "horniMira"}
        if "typReviru" in row and value(value(row["typReviru"])["kod"]) != "MIMOPSTRUHOVY":
            raise SourceChanged("Unexpected fishery class for the pilot water")
        if row.keys() - known or key in records:
            raise SourceChanged("Duplicate or unsupported local rule")
        start = date.fromisoformat(value(row["datumOd"]))
        end = date.fromisoformat(value(row["datumDo"]))
        closed = value(row["jeHajen"])
        if end < start or type(closed) is not bool:
            raise SourceChanged("Invalid local period")
        record = {"from": start.isoformat(), "until": end.isoformat(), "closed": closed}
        for field, target in (("dolniMira", "minCm"), ("horniMira", "maxCm")):
            if field in row:
                length = value(row[field])
                if type(length) is not int or not 0 < length <= 300:
                    raise SourceChanged("Invalid local length")
                record[target] = length
        if record.get("maxCm", 300) < record.get("minCm", 0):
            raise SourceChanged("Inverted local size limits")
        records[key] = record
    if not records:
        raise SourceChanged("Empty local rules")
    return records
