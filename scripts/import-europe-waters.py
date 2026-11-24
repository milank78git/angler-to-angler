"""Read public fishery registers. Each provider owns its IDs, geographical scope and source date."""
import argparse
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from osgeo import ogr, osr

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
BERLIN = "https://gdi.berlin.de/services/wfs/angelgewaesser"
SRZ = "https://srzrada.sk/rybarske-poriadky/"
ARCGIS = {
    "IFI": ("https://services-eu1.arcgis.com/tnPmSZbB6GEKJjh8/arcgis/rest/services/AccessibleAnglingSites_shp/FeatureServer/0", "OBJECTID", "NAME", "IFI_OFFICE"),
    "ICNF": ("https://sigservices.icnf.pt/server/rest/services/BDG/concessoes_pesca/MapServer/0", "gid", "curso_agua", "bacia"),
    "DAERA": ("https://services-eu1.arcgis.com/kswen6BYexuc1SUk/arcgis/rest/services/Public_Angling_Estate/FeatureServer/0", "GlobalID", "PAE_Name", "County"),
}


def get(url, limit=32000000):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "AnglerToAngler/1.0"}), timeout=45) as res:
                raw = res.read(limit + 1)
            if len(raw) > limit:
                raise ValueError("Unexpectedly large provider response")
            return raw
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def projection(source, target):
    refs = []
    for code in (source, target):
        ref = osr.SpatialReference()
        ref.ImportFromEPSG(code)
        ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        refs.append(ref)
    return osr.CoordinateTransformation(*refs)


def source_geometry(geo):
    """Import published points and polygons, retaining separate parts and holes."""
    geometry = ogr.CreateGeometryFromJson(json.dumps(geo))
    if geometry.GetGeometryName() == "POINT":
        return {"points": [[round(geometry.GetX(), 5), round(geometry.GetY(), 5)]]}
    if geometry.GetGeometryName() not in ("POLYGON", "MULTIPOLYGON", "LINESTRING", "MULTILINESTRING"):
        raise ValueError("Unknown fishery geometry")
    geometry.Transform(projection(4326, 3035))
    geometry = geometry.SimplifyPreserveTopology(20)
    geometry.Transform(projection(3035, 4326))
    if geometry.GetGeometryName() in ("LINESTRING", "MULTILINESTRING"):
        lines = [geometry] if geometry.GetGeometryName() == "LINESTRING" else geometry
        return {"lines":[[[round(x, 5), round(y, 5)] for x, y, *_ in line.GetPoints()] for line in lines]}
    parts = [geometry] if geometry.GetGeometryName() == "POLYGON" else geometry
    return {"outline": [[[[round(x, 5), round(y, 5)] for x, y, *_ in ring.GetPoints()]
                         for ring in polygon] for polygon in parts]}


def arcgis(provider):
    url, key, name, area = ARCGIS[provider]
    ids = json.loads(get(url + "/query?where=1%3D1&returnIdsOnly=true&f=json"))["objectIds"]
    rows = []
    for offset in range(0, len(ids), 50):
        batch = ids[offset:offset + 50]
        params = {"objectIds": ",".join(map(str, batch)), "outFields": ",".join((key, name, area)),
                  "returnGeometry": "true", "outSR": "4326", "f": "geojson"}
        data = json.loads(get(url + "/query?" + urlencode(params)))
        if len(data["features"]) != len(batch):
            raise ValueError("Incomplete ArcGIS page")
        for feature in data["features"]:
            prop = feature["properties"]
            rows.append({"code": str(prop[key]).strip("{}"), "name": prop[name].strip(), "area": prop[area] or "",
                         **source_geometry(feature["geometry"])})
    return rows


def luxembourg():
    catalogue = json.loads(get("https://data.public.lu/api/1/datasets/sections-de-peche/"))
    # The official catalogue also lists archived exports. Pick the latest GeoJSON resource.
    files = [r for r in catalogue["resources"] if r["format"] == "geojson"
             and urlsplit(r["url"]).hostname == "download.data.public.lu" and r["url"].startswith("https://")]
    url = max(files, key=lambda r: r.get("last_modified") or r["created_at"])["url"]
    rows = []
    for feature in json.loads(get(url))["features"]:
        prop = feature["properties"]
        record = {"code":str(prop["OBJECTID"]), "name":prop["Gewaesser"].strip(),
                  **source_geometry(feature["geometry"])}
        if prop.get("lot"):
            record["number"] = str(prop["lot"])
        if prop.get("Symbology") == "non adjugé":
            record["status"] = "non adjugé"
        rows.append(record)
    return rows


def swedish():
    # The country register labels active management areas with reference points.
    # ID_FVOF identifies the association across publications; OBJECTID is only for paging.
    url = "https://ext-geodata-acc.lansstyrelsen.se/arcgis/rest/services/svenskafiskekartan/lst_svenskafiskekartan/MapServer/11/query?"
    params = {"where": "Status='Aktiv'"}
    expected = json.loads(get(url + urlencode({**params, "returnCountOnly":"true", "f":"json"})))["count"]
    rows = []
    for offset in range(0, expected, 800):
        query = {**params, "outFields":"ID_FVOF,Namn,Status", "outSR":4326, "orderByFields":"OBJECTID",
                 "resultOffset":offset, "resultRecordCount":800, "f":"geojson"}
        for feature in json.loads(get(url + urlencode(query)))["features"]:
            prop = feature["properties"]
            if not isinstance(prop["ID_FVOF"], int) or prop["Status"] != "Aktiv":
                raise ValueError("Unexpected management area identity")
            rows.append({"code":str(prop["ID_FVOF"]), "name":prop["Namn"].strip(), **source_geometry(feature["geometry"])})
    if len(rows) != expected:
        raise ValueError("Incomplete Swedish management area register")
    return rows


def berlin():
    params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature",
              "typeNames": "angelgewaesser:c_angel_gew", "outputFormat": "application/json", "srsName": "EPSG:4326"}
    data = json.loads(get(BERLIN + "?" + urlencode(params)))
    if len(data["features"]) != int(data["numberMatched"]):
        raise ValueError("Incomplete Berlin fishery layer")
    return [{"code": str(f["properties"]["id"]), "name": f["properties"]["name"], "area": "Berlin",
             **source_geometry(f["geometry"])} for f in data["features"]]


class BookLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.books = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and "srz-poriadok-link" in a.get("class", "").split():
            url = a.get("href", "")
            if urlsplit(url).hostname in {"srzrada.sk", "srzrada.xandraone.com"} and url.startswith("https://"):
                if re.search(r'(?:kaprov|lipnov|zvlastny).*\.pdf$', url, re.I):
                    self.books.append(url)


def slovak():
    links = BookLinks()
    links.feed(get(SRZ).decode())
    if not links.books:
        raise ValueError("SRZ permit books missing")
    records = {}
    with TemporaryDirectory() as folder:
        path = Path(folder) / "book.pdf"
        for url in dict.fromkeys(links.books):
            path.write_bytes(get(url))
            text = subprocess.run(["pdftotext", "-q", "-raw", str(path), "-"], check=True, capture_output=True).stdout.decode()
            # Discard the illustrative sample and use the actual list of waters.
            parsed = 0
            for page in text.split("\f"):
                if "PRÍKLAD:" in page:
                    continue
                lines = page.splitlines()
                for i, line in enumerate(lines):
                    code = line.strip()
                    if not re.fullmatch(r"[1-4]-\d{4}-\d-\d", code):
                        continue
                    header = " ".join(" ".join(lines[i + 1:i + 4]).split())
                    org = re.search(r"\b(?:MsO|MO|SRZ|OZ|ŠH|ŠP|Rada|Miestna)\b", header, re.I)
                    if not org:
                        continue
                    name = header[:org.start()].strip(" ,")
                    if name and len(name) <= 150:
                        parsed += 1
                        records.setdefault(code, {"code": code, "name": name, "number": code})
            if not parsed:
                raise ValueError("Unrecognised SRZ book layout")
    return list(records.values())


def build(provider):
    osr.UseExceptions()
    if provider in ARCGIS:
        rows = arcgis(provider)
    elif provider == "AGE":
        rows = luxembourg()
    elif provider == "FVO":
        rows = swedish()
    elif provider == "BERLIN":
        rows = berlin()
    elif provider == "SRZ":
        rows = slovak()
    else:
        raise ValueError(provider)
    if not rows or len({r["code"] for r in rows}) != len(rows):
        raise ValueError("Empty register or duplicate source identity: " + provider)
    return sorted(rows, key=lambda r: r["code"])


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provider", choices=[*ARCGIS, "AGE", "FVO", "BERLIN", "SRZ"])
    parser.add_argument("output", type=Path)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    records = build(args.provider)
    save(args.output, {"asOf": args.as_of.isoformat(), "waters": records})
    print(args.provider, len(records))
