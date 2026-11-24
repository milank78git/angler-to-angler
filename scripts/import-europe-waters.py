"""Read public fishery registers. Each provider owns its IDs, geographical scope and source date."""
import argparse
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from html.parser import HTMLParser
from functools import lru_cache
from xml.etree import ElementTree
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


@lru_cache(maxsize=4)
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
    if geometry.GetGeometryName() == "MULTIPOINT":
        return {"points": [[round(p.GetX(), 5), round(p.GetY(), 5)] for p in geometry]}
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
                if re.search(r'(?:kaprov|lipnov|pstruhov|zvlastny).*\.pdf$', url, re.I):
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


def zipped_features(url, layer_name):
    """Read one published shapefile through GDAL's read-only ZIP driver and reproject to WGS84."""
    with TemporaryDirectory() as folder:
        archive = Path(folder) / "source.zip"
        archive.write_bytes(get(url))
        dataset = ogr.Open("/vsizip/" + str(archive) + "/" + layer_name)
        if dataset is None:
            raise ValueError("Expected a shapefile in the official download")
        layer = dataset.GetLayer(0)
        source = layer.GetSpatialRef().Clone()
        source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        target = osr.SpatialReference()
        target.ImportFromEPSG(4326)
        target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        transform = osr.CoordinateTransformation(source, target)
        for feature in layer:
            geometry = feature.GetGeometryRef().Clone()
            if geometry.Transform(transform) != 0:
                raise ValueError("Could not reproject a fishery feature")
            yield feature.items(), source_geometry(json.loads(geometry.ExportToJson()))


def upper_austria():
    url = "https://e-gov.ooe.gv.at/at.gv.ooe.dorisdaten/DORIS_U/FISCHEREIRECHTE.zip"
    rows = {}
    for fields, geometry in zipped_features(url, "FISCHEREIRECHTE.shp"):
        number = (fields["RevierNr"] or "").strip()
        if not number:
            continue  # Unidentified map fragments cannot be assigned a report or discussion.
        district = str(fields["BEZ"])
        key = district + "-" + number.encode("utf-8").hex()
        record = rows.setdefault(key, {"code":key, "name":"Fischereirecht " + number, "number":number,
                                       "area":"Oberösterreich · Bezirk " + district, "lines":[]})
        record["lines"].extend(geometry["lines"])
    return list(rows.values())


def maine_loire():
    url = "https://atom.geo-ide.developpement-durable.gouv.fr/atomArchive/GetResource?id=b9f0952c-b727-4d53-be36-0b27a5eb26b4&dataType=dataset"
    layer = "dataset/L_PECHE_PARCOURS_CARPE_NUIT_S_049.shp"
    return [{"code":p["ID"], "name":p["Nom"], "number":p["ID"], "area":p["riviere"] + " · " + p["COM_2019"], **geo}
            for p, geo in zipped_features(url, layer)]


def danish():
    url = "https://geofa.geodanmark.dk/api/v2/sql/fkg?"
    selection = " from fkg.t_5800_fac_pkt where facil_ty_k in (2031,2171,4411,4422) and statuskode=3 and off_kode=1"
    def query(sql):
        data = json.loads(get(url + urlencode({"q":sql, "srs":4326})))
        if not data["success"]:
            raise ValueError("GeoFA query failed")
        return data["features"]
    count = query("select count(*) as n" + selection)[0]["properties"]["n"]
    rows = []
    for offset in range(0, int(count), 500):
        sql = "select objekt_id,navn,facil_ty,cvr_navn,geometri" + selection + " order by objekt_id limit 500 offset " + str(offset)
        for f in query(sql):
            p = f["properties"]
            name = (p["navn"] or "").strip() or p["facil_ty"]
            rows.append({"code":p["objekt_id"], "name":name, "area":p["cvr_navn"], "status":p["facil_ty"],
                         **source_geometry(f["geometry"])})
    if len(rows) != int(count):
        raise ValueError("Incomplete Danish facilities")
    return rows


def castile_leon():
    # The same layer also contains protected refuges. Select the explicitly designated COTO class.
    params = {"service":"WFS", "version":"2.0.0", "request":"GetFeature", "typeNames":"piscis:visor_tramos",
              "CQL_FILTER":"title ILIKE 'COTO-%'", "srsName":"EPSG:4326", "outputFormat":"application/json", "count":1000}
    data = json.loads(get("https://vps24geoserver.cesefor.com/geoserver/piscis/ows?" + urlencode(params)))
    if len(data["features"]) != int(data["numberMatched"]):
        raise ValueError("Incomplete Castile and León fishery register")
    rows = []
    for f in data["features"]:
        p = f["properties"]
        rows.append({"code":str(p["nid"]), "number":p["codigo_tramo"], "name":p["title"].split("-",1)[1].strip(),
                     **source_geometry(f["geometry"])})
    return rows


def zurich():
    # The third WFS layer describes administrative areas on land. Use the two actual water layers.
    url = "https://maps.zh.ch/wfs/OGDZHWFS?"
    rows = {}
    for suffix in ("stillgewaesser_f", "gewaessernetz_l"):
        params = {"service":"WFS","version":"2.0.0","request":"GetFeature","typeNames":"ms:ogd-0314_giszhpub_fischrevier_" + suffix}
        count = int(ElementTree.fromstring(get(url + urlencode({**params,"resultType":"hits"}))).attrib["numberMatched"])
        seen = set()
        for offset in range(0,count,1000):
            query = {**params, "srsName":"EPSG:4326", "outputFormat":"application/json", "sortBy":"geodb_oid",
                     "count":1000, "startIndex":offset}
            features = json.loads(get(url + urlencode(query)))["features"]
            for f in features:
                p = f["properties"]
                seen.add(p["geodb_oid"])
                if not p.get("reviernummer") or not (p.get("fischrevier") or "").strip():
                    continue
                number = str(p["reviernummer"])
                record = rows.setdefault(number, {"code":number, "number":number, "name":p["fischrevier"].strip()})
                for key, pieces in source_geometry(f["geometry"]).items():
                    record.setdefault(key, []).extend(pieces)
        if len(seen) != count:
            raise ValueError("Incomplete Zürich fishery layer: " + suffix)
    return list(rows.values())



def polish_union():
    # PZW's public paginated directory embeds the records used by its map alongside each results page.
    base = "https://pzw.pl/strefa-wedkarza/lowiska-i-wody-pzw"
    def page(number):
        source = get(base + "?active_page=" + str(number)).decode("utf-8")
        match = re.search(r'class="myajaxlist_content myajaxlist_content_fishery_list\s*" data-pagescount="(\d+)"', source)
        marker = ".html('<h3>[{"
        if not match or marker not in source:
            raise ValueError("Unrecognised PZW directory page")
        start = source.index(marker) + len(".html('<h3>")
        # Attribute entities quote the JSON. Consume the array only, never execute publisher scripts.
        data, _ = json.JSONDecoder().raw_decode(unescape(source[start:source.index("</script>", start)]))
        return int(match[1]), data
    pages, first = page(1)
    if not 1 <= pages <= 1000:
        raise ValueError("Unexpected PZW page count")
    unique = set()
    rows = []
    def collect(number, count, records):
        if count != pages or not records or (number < pages and len(records) != len(first)):
            raise ValueError("Incomplete PZW directory")
        for p in records:
            key = str(p["id"])
            if key in unique:
                raise ValueError("Duplicate PZW identity across pages")
            unique.add(key)
            name = " ".join((p["name"] or "").split())
            if p["active"] != 1 or p["deleted_at"] or not name:
                continue
            row = {"code":key, "name":name}
            lon, lat = p["e_coordinate"], p["n_coordinate"]
            # Discard an unpublished/default map pin. Keep the named record in the directory.
            if isinstance(lon, (int,float)) and isinstance(lat, (int,float)) and 14 <= lon <= 24.3 and 48.9 <= lat <= 55.2:
                row["points"] = [[round(lon,5),round(lat,5)]]
            rows.append(row)
    collect(1,pages,first)
    with ThreadPoolExecutor(max_workers=3) as workers:
        for number, (count, records) in enumerate(workers.map(page, range(2,pages+1)), 2):
            collect(number,count,records)
    return rows



ADAPTERS = {"PZW":polish_union, "AGE":luxembourg, "FVO":swedish, "BERLIN":berlin, "SRZ":slovak,
            "DORIS":upper_austria, "DDT49":maine_loire, "GEOFA":danish, "CYL":castile_leon, "ZH":zurich}


def build(provider):
    osr.UseExceptions()
    rows = arcgis(provider) if provider in ARCGIS else ADAPTERS[provider]()
    if not rows or len({r["code"] for r in rows}) != len(rows):
        raise ValueError("Empty register or duplicate source identity: " + provider)
    return sorted(rows, key=lambda r: r["code"])


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("provider", choices=[*ARCGIS, *ADAPTERS])
    parser.add_argument("output", type=Path)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    records = build(args.provider)
    save(args.output, {"asOf": args.as_of.isoformat(), "waters": records})
    print(args.provider, len(records))
