"""Rebuild the reviewable European species and country assets from attributed public data.

Run with a private cache directory. No observation, image, coordinates or observer is distributed.
Pinned basin records supplement country-tagged research-grade records without guessing a country.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from country_evidence import apply_checklists

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "app/src/main/assets"
RIV = "https://zenodo.org/records/14509748/files/RivFISH_database_v.1.1.zip?download=1"
EEA = "https://sdi.eea.europa.eu/datashare/s/FQMerS9EFXsm4RP/download"
EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson"
COUNTRIES = "AD AL AM AT AZ BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GE GR HR HU IE IS IT KZ LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA VA XK".split()
FISH = "47178,47273,60450,49099,49231"
NAMES = {"VA":"Vatican City", "RS":"Serbia", "BA":"Bosnia and Herzegovina", "TR":"Turkey", "XK":"Kosovo"}
# A reproducible European window excludes most overseas records of transcontinental states.
EXTENT = dict(swlat=27,swlng=-33,nelat=83,nelng=70)


def fetch(url, cache, validate=None):
    path = cache / hashlib.sha256(url.encode()).hexdigest()
    if path.exists():
        return path.read_bytes()
    for attempt in range(4):
        try:
            if "api.inaturalist" in url: time.sleep(1)
            req = urllib.request.Request(url, headers={"User-Agent":"Angler-to-Angler regional field guide/1.0"})
            with urllib.request.urlopen(req, timeout=45) as response:
                body = response.read()
            if validate:
                validate(body)
            path.write_bytes(body)
            return body
        except (OSError, ValueError):
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def api(path, params, cache):
    url = "https://api.inaturalist.org/v1/" + path + "?" + urllib.parse.urlencode(params)
    return json.loads(fetch(url, cache, json.loads))


def write(name, obj):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))+"\n"
    (ASSETS / name).write_text(text)


def reduce_line(points, tolerance=0.035):
    """Simplify a ring but keep small islands and holes identifiable."""
    if len(points) < 5:
        return points
    a,b = points[0],points[-1]
    dx,dy = b[0]-a[0], b[1]-a[1]
    length = dx*dx+dy*dy
    def distance(point):
        x,y = point[0]-a[0],point[1]-a[1]
        t = min(1,max(0,(x*dx+y*dy)/length)) if length else 0
        return (x-t*dx)**2+(y-t*dy)**2
    i = max(range(1,len(points)-1),key=lambda j: distance(points[j]))
    if distance(points[i]) < tolerance**2:
        return [a,b]
    return reduce_line(points[:i+1],tolerance)[:-1]+reduce_line(points[i:],tolerance)


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--cache",type=Path,required=True)
    cfg=args.parse_args(); cfg.cache.mkdir(parents=True,exist_ok=True)
    raw = fetch(RIV,cfg.cache)
    if hashlib.md5(raw).hexdigest()!="d241eb812e67be454981e62b8d01fa84":
        raise ValueError("RivFISH release changed; review its version and checksum")
    archive=zipfile.ZipFile(io.BytesIO(raw))
    records={}
    place_aliases = json.loads((ROOT / "data/europe/place-aliases.json").read_text())
    def row(name):
        return records.setdefault(name,{"latin":name,"countries":[]})
    def table(filename):
        return csv.DictReader(io.TextIOWrapper(archive.open(filename),encoding="utf-8-sig"),delimiter=";")
    accepted = {r["accepted_name_ID"]: r["accepted_name"].strip() for r in table("Current_species.csv")}
    aliases_by_name = {}
    for source in table("Species_names.csv"):
        candidate = accepted.get(source["accepted_name_ID"])
        if candidate and candidate != source["Taxon"]:
            aliases_by_name.setdefault(source["Taxon"], set()).add(candidate)
    for item in table("Current_species.csv"):
        row(item["accepted_name"].strip())["river"]=True
    # The archive wrapper has a generated timestamp. Verify its actual source table instead.
    eea = zipfile.ZipFile(io.BytesIO(fetch(EEA,cfg.cache)))
    table_bytes = eea.read(next(n for n in eea.namelist() if n.endswith(".csv")))
    if hashlib.sha256(table_bytes).hexdigest() != "7c72989c604e265f013a4e4b4bb0f9e383e3e5df10f085227212b21ef0d97f4b":
        raise ValueError("EEA assessment table changed; review before publishing")
    for taxon in csv.DictReader(io.StringIO(table_bytes.decode("utf-8-sig"))):
        group = taxon["speciesGroup"]
        if group not in ("Marine_Fishes","Freshwater_Fishes") or taxon["taxonomicRankSubspecies"]: continue
        name = taxon["scientificName"].strip()
        if not re.fullmatch(r"[A-Z][a-z]+ [a-z-]+", name): continue
        fish = row(name)
        fish["marine" if group=="Marine_Fishes" else "river"] = True
        fish.setdefault("assessments",{})[group] = {key:taxon[key] for key in
            ("europeanRegionalRedListCategory","populationTrend","endemicToEurope","extracted") if taxon[key]}
        fish["family"] = taxon["taxonomicRankFamily"].title()
    geography=json.loads(fetch(EARTH,cfg.cache))
    countries={}; boundaries={}
    for feat in geography["features"]:
        prop=feat["properties"]; code=prop["ISO_A2_EH"]
        if code not in COUNTRIES and code != "US": continue
        if code in COUNTRIES: countries[code]=NAMES.get(code,prop["ADMIN"])
        geom=feat["geometry"]; polys=geom["coordinates"] if geom["type"]=="MultiPolygon" else [geom["coordinates"]]
        boundaries[code]=[]
        for poly in polys:
            if code != "US" and not any(-34<=p[0]<=71 and 26<=p[1]<=84 for p in poly[0]): continue
            rings=[]
            for ring in poly:
                small=reduce_line(ring)
                rings.append([[round(x,4),round(y,4)] for x,y in (small if len(small)>=4 else ring)])
            boundaries[code].append(rings)
    assert set(countries)==set(COUNTRIES)
    write("us-borders.json", {"US": boundaries.pop("US")})
    write("europe-borders.json",boundaries)
    places=json.loads((ROOT/"data/europe/places.json").read_text())
    for code in COUNTRIES:
        if code not in places:
            found=api("places/autocomplete",dict(q=countries[code],per_page=12),cfg.cache)["results"]
            candidates=[p for p in found if p.get("admin_level")==0 and
                        p["name"].casefold() in {countries[code].casefold(), place_aliases.get(code)}]
            if len(candidates)!=1: raise ValueError(f"Review country identifier for {code}: {[(p['id'],p['name']) for p in found[:6]]}")
            places[code]=candidates[0]["id"]
            (ROOT/"data/europe/places.json").write_text(json.dumps(places,sort_keys=True,indent=2)+"\n")
        page=1; seen=set()
        while True:
            result=api("observations/species_counts",dict(place_id=places[code],taxon_id=FISH,quality_grade="research",
                captive="false",license="cc0",locale="cs",per_page=200,page=page,**EXTENT),cfg.cache)
            batch=result["results"]
            for hit in batch:
                tax=hit["taxon"]
                if tax["id"] in seen: continue
                seen.add(tax["id"])
                if tax["rank"]!="species" or not tax.get("is_active"): continue
                if not set(map(int,FISH.split(","))).intersection(tax["ancestor_ids"]): continue
                name=tax["name"]; item=row(name)
                if code not in item["countries"]: item["countries"].append(code)
                item["inat"]=tax["id"]
                common=tax.get("preferred_common_name")
                if common and common!=name: item.setdefault("name",common)
            if not batch or len(seen)>=result["total_results"] or len(batch)<200: break
            if page>40: raise ValueError("Unexpected page count")
            page+=1
        print(code,len(seen),flush=True)
    # Only adopt unambiguous published synonym mappings. Preserve source names for search.
    for synonym, targets in aliases_by_name.items():
        if len(targets) != 1 or synonym in accepted.values(): continue
        name = next(iter(targets))
        alternate = records.pop(synonym, {})
        fish = row(name)
        fish.setdefault("aliases", []).append(synonym)
        fish["countries"] = sorted(set(fish["countries"] + alternate.pop("countries", [])))
        for key, value in alternate.items():
            if key != "latin": fish.setdefault(key, value)
    observed = {name: fish.pop("name") for name, fish in records.items() if "name" in fish}
    (ROOT / "data/europe/observed-fish-names-cs.json").write_text(
        json.dumps(observed, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    apply_checklists(records.values(), json.loads((ASSETS/"europe-checklists.json").read_text()))
    write("europe-fish.json",{"countries":COUNTRIES,"species":sorted(records.values(),key=lambda x:x["latin"])})


if __name__=="__main__":
    main()
