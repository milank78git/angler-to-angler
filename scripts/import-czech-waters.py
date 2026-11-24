"""Build the offline Czech fishery directory from the public RIS and MRS map clients' feeds.

Requires Python 3 and GDAL's Python bindings. Use a fresh cache for every publication.
Example: python3 scripts/import-czech-waters.py /tmp/water-cache --download --as-of 2026-11-24
Pass --sql PATH to write a NEW additive migration for a reviewed release.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
from pathlib import Path
import re
import time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from osgeo import ogr, osr

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
MRS = "https://mrsbrno.cz"
SCHEMA = json.loads((ROOT / "data/waters/cz-provider-schema.json").read_text())
FIELDS = SCHEMA["fields"]
RIS_API = SCHEMA["directoryUrl"]
# Map overview extent used by RIS in S-JTSK / Krovak East North.
EXTENT = "-925000,-1444353.53,-400646.46,-920000"
PILOT = {"4615401": "CZ:401001", "4615408": "CZ:401009"}


def read(path):
    return json.loads(path.read_bytes())


def request(url, headers=None):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers=headers or {}), timeout=90) as response:
                return json.load(response)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def cached(path, url, headers=None):
    if not path.exists():
        obj = request(url, headers)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".partial")
        tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    return read(path)


def ris_pages(cache, spatial=False):
    size = 40 if spatial else 100
    folder = "geography" if spatial else "bohemia"
    params = {"size": size, "getTotal": "true"}
    if spatial:
        params.update({"filter.bbox": EXTENT, SCHEMA["geometryOption"]: "true"})
    offset, rows = 0, []
    while True:
        url = RIS_API + "?" + urlencode(dict(params, **{"from": offset}))
        page = cached(cache / folder / f"{offset}.json", url)
        if page.get("from") != offset or not page["items"] or (offset and page["total"] != total):
            raise ValueError(f"Incomplete or changing {folder} listing at {offset}")
        total = page["total"]
        rows.extend(page["items"])
        offset += len(page["items"])
        if offset >= total:
            break
    if len(rows) != total or (not spatial and len({r["sid"] for r in rows}) != total):
        raise ValueError(f"Inconsistent {folder} directory")
    return rows


def download(cache):
    crs = ris_pages(cache)
    mapped = {r["sid"] for r in ris_pages(cache, True) if r.get(FIELDS["boundaries"])}
    def detail(row):
        cached(cache / "ris-details" / (row["sid"] + ".json"),
               RIS_API + "/by-friendly-url/" + quote(row["friendlyUrl"], safe=""))
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(detail, (row for row in crs if row["sid"] not in mapped)))

    # Same public client configuration and read-only directory requests as mrsbrno.cz/reviry.
    config = request(MRS + "/appsettings.json")["api"]
    headers = {"WebApiKey": config["apiKey"]}
    api = MRS + config["baseUrl"] + "/public-district"
    number, ids = 1, []
    while True:
        page = cached(cache / f"mrs-{number}.json", f"{api}?Page={number}&PageSize=100", headers)
        if not page["items"] or page["page"] != number or (number > 1 and page["totalCount"] != total):
            raise ValueError("Incomplete or changing MRS listing")
        total = page["totalCount"]
        ids.extend(row["id"] for row in page["items"])
        if len(ids) >= total:
            break
        number += 1
    if len(ids) != total or len(set(ids)) != total:
        raise ValueError("Duplicate or missing MRS records")
    def mrs_detail(record_id):
        cached(cache / "moravia" / f"{record_id}.json", f"{api}/{record_id}", headers)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(mrs_detail, ids))


def read_pages(paths, total_key, unique_key=None):
    pages = [read(path) for path in paths]
    rows = [row for page in pages for row in page["items"]]
    if not pages or any(page[total_key] != len(rows) for page in pages):
        raise ValueError("Incomplete cached directory")
    if unique_key and len({row[unique_key] for row in rows}) != len(rows):
        raise ValueError("Duplicate source identity in directory")
    return rows


def point(lon, lat):
    # Some source locations have zero or missing coordinates. Never place these on the map.
    try:
        lon, lat = float(lon), float(lat)
    except (ValueError, TypeError):
        return None
    if 12 <= lon <= 19 and 48.5 <= lat <= 51.1:
        return [round(lon, 5), round(lat, 5)]


def projection():
    osr.UseExceptions()
    refs = []
    for epsg in (5514, 4326):
        ref = osr.SpatialReference()
        ref.ImportFromEPSG(epsg)
        ref.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        refs.append(ref)
    return osr.CoordinateTransformation(*refs)


def polygons(feature, transform):
    """Keep separate surfaces and interior rings when simplifying the published map outline."""
    geometry = ogr.CreateGeometryFromJson(json.dumps(feature))
    if geometry.GetGeometryName() not in ("POLYGON", "MULTIPOLYGON"):
        raise ValueError("Unexpected RIS geometry type")
    geometry = geometry.SimplifyPreserveTopology(35)
    if geometry.Transform(transform) != 0:
        raise ValueError("Unable to transform RIS geometry")
    parts = [geometry] if geometry.GetGeometryName() == "POLYGON" else geometry
    result = []
    for polygon in parts:
        rings = []
        for ring in polygon:
            points = [point(lon, lat) for lon, lat, *_ in ring.GetPoints()]
            if not points or None in points:
                raise ValueError("Invalid RIS polygon coordinates")
            rings.append(points)
        if rings:
            result.append(rings)
    return result


def build(cache, as_of):
    waters, shapes = [], {}
    transform = projection()
    directory = read_pages((cache / "bohemia").glob("*.json"), "total", "sid")
    mapping = {r["sid"]: r[FIELDS["boundaries"]] for r in
               read_pages((cache / "geography").glob("*.json"), "total") if r.get(FIELDS["boundaries"])}
    for r in directory:
        sid = r["sid"]
        key = PILOT.get(sid, "CZ:CRS:" + sid)
        row = {"id": key, "number": r[FIELDS["number"]], "name": r[FIELDS["name"]].strip(), "provider": "CRS",
               "slug": r["friendlyUrl"], "trout": SCHEMA["troutTypes"][r[FIELDS["fisheryType"]][FIELDS["code"]]],
               "kind": SCHEMA["waterTypes"][r[FIELDS["waterType"]][FIELDS["code"]]],
               "region": r.get(FIELDS["region"], {}).get(FIELDS["shortName"], ""), "manager": r.get(FIELDS["manager"], {}).get(FIELDS["shortName"], "")}
        feature = mapping.get(sid)
        if not feature:
            detail = read(cache / "ris-details" / (sid + ".json"))
            if (detail["sid"], detail[FIELDS["number"]]) != (sid, row["number"]):
                raise ValueError(f"RIS card mismatch: {sid}")
            feature = detail.get(FIELDS["boundaries"])
            pt = point(detail.get(FIELDS["longitude"]), detail.get(FIELDS["latitude"]))
            if pt:
                row["points"] = [pt]
        if feature:
            shape = polygons(feature, transform)
            if shape:
                shapes[key] = shape
                row["mapped"] = True
        waters.append(row)
    for item in read_pages(cache.glob("mrs-*.json"), "totalCount", "id"):
        r = read(cache / "moravia" / f"{item['id']}.json")
        if (r["id"], r["code"]) != (item["id"], item["code"]):
            raise ValueError("MRS card mismatch")
        if (r.get("validFrom") or "") > as_of or (r.get("validTo") or as_of) < as_of:
            continue
        pts = []
        def add(lon, lat):
            pt = point(lon, lat)
            if pt and pt not in pts:
                pts.append(pt)
        for place in r.get("locations") or []:
            add(place.get("longitude"), place.get("latitude"))
        for part in r.get("parts") or []:
            if part.get("isActive") is not False:
                add(part.get("longitude"), part.get("latitude"))
                if part.get("hasStartAndEnd"):
                    add(part.get("endLongitude"), part.get("endLatitude"))
        row = {"id": "CZ:MRS:" + str(r["id"]), "number": r["code"], "name": r["name"].strip(),
               "provider": "MRS", "slug": str(r["id"]), "trout": r["isTroutType"],
               "kind": SCHEMA["districtTypes"][r["type"]], "region": r.get("region") or "",
               "manager": (r.get("belongsToGroup") or {}).get("name", "")}
        if pts:
            row["points"] = pts
        for field in ("acreage", "length"):
            if r.get(field) and r[field] > 0:
                row[field] = r[field]
        waters.append(row)
    if len({w["id"] for w in waters}) != len(waters) or not set(PILOT.values()) <= {w["id"] for w in waters}:
        raise ValueError("Unstable water identity")
    return sorted(waters, key=lambda w: (w["number"], w["id"])), shapes


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def seed(waters):
    literal = lambda v: "'" + v.replace("'", "''") + "'"
    items = []
    for w in waters:
        if w["id"] not in PILOT.values():
            number = re.sub(r"^(\d{3})(\d{3})(?=/|$)", r"\1 \2", w["number"])
            items.append("(" + literal(w["id"]) + "," + literal(w["name"] + " · " + number) + ")")
    return ("-- Add imported waters without removing historical report or discussion targets.\n"
            "with directory(key,label) as (values\n" + ",\n".join(items) + "\n), registered as (\n"
            "  insert into angler_discussions.waters(key,zone) select key,'Europe/Prague' from directory\n"
            "  on conflict (key) do update set zone=excluded.zone returning key\n)\n"
            "insert into angler_public_cards.waters(key,label)\n"
            "select r.key,d.label from registered r join directory d using(key)\n"
            "on conflict (key) do update set label=excluded.label;\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--sql", type=Path)
    args = parser.parse_args()
    if args.download:
        download(args.cache)
    stamp = args.as_of.isoformat()
    waters, shapes = build(args.cache, stamp)
    if args.sql:
        with args.sql.open("x", encoding="utf8") as migration:
            migration.write(seed(waters))
    (ASSETS / "czech-waters.json").write_text('{"asOf":' + compact(stamp) + ',"waters":[\n' +
        ",\n".join(map(compact, waters)) + "\n]}\n")
    (ASSETS / "czech-water-shapes.json").write_text("{\n" + ",\n".join(
        compact(key) + ":" + compact(shapes[key]) for key in sorted(shapes)) + "\n}\n")
    print(f"{len(waters)} directory entries, {len(shapes)} with outlines")
