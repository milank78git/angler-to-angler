"""Attach CC0 georeferenced present-day occurrence evidence to existing species by fish order.

Read order names from the pinned EEA assessment. Query country and European coordinate bounds
together. Retain only country and scientific name, never specimens, coordinates or observer IDs.
"""
import argparse
import concurrent.futures
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

parser = argparse.ArgumentParser()
parser.add_argument('--cache',type=Path,required=True)
parser.add_argument('--eea',type=Path,required=True,help='EEA European Red List archive')
cfg=parser.parse_args()
cfg.cache.mkdir(parents=True,exist_ok=True)
assets=Path(__file__).resolve().parents[1]/'app/src/main/assets'
path=assets/'europe-fish.json'
catalogue=json.loads(path.read_text())
with zipfile.ZipFile(cfg.eea) as archive:
    raw=archive.read(next(f for f in archive.namelist() if f.endswith('.csv')))
if hashlib.sha256(raw).hexdigest()!='7c72989c604e265f013a4e4b4bb0f9e383e3e5df10f085227212b21ef0d97f4b':
    raise ValueError('Review the EEA release before using its order list')
orders=sorted({r['taxonomicRankOrder'].title() for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
               if r['speciesGroup'] in ('Freshwater_Fishes','Marine_Fishes') and r['taxonomicRankOrder']})
lookup={fish['latin']:fish for fish in catalogue['species']}
for fish in catalogue['species']:
    for alias in fish.get('aliases',[]): lookup.setdefault(alias,fish)

def occurrences(code,batch):
    names=set()
    offset=0
    while True:
        params=dict(country=code,hasCoordinate='true',hasGeospatialIssue='false',occurrenceStatus='PRESENT',
                    license='CC0_1_0',decimalLatitude='27,83',decimalLongitude='-33,70',limit=0,
                    facet='scientificName',facetLimit=500,facetOffset=offset,scientificName=batch,
                    basisOfRecord=['HUMAN_OBSERVATION','MACHINE_OBSERVATION','PRESERVED_SPECIMEN'])
        url='https://api.gbif.org/v1/occurrence/search?'+urllib.parse.urlencode(params,doseq=True)
        cached=cfg.cache/hashlib.sha256(url.encode()).hexdigest()
        if cached.exists():
            result=json.loads(cached.read_text())
        else:
            for attempt in range(4):
                try:
                    req=urllib.request.Request(url,headers={'User-Agent':'AnglerToAngler/0.15 country aggregate'})
                    with urllib.request.urlopen(req,timeout=38) as response: result=json.load(response)
                    cached.write_text(json.dumps(result))
                    break
                except (OSError,ValueError):
                    if attempt==3: raise
                    time.sleep(2**attempt)
        counts=next((f['counts'] for f in result['facets'] if f['field']=='SCIENTIFIC_NAME'),[])
        for item in counts:
            parts=item['name'].split()
            if len(parts)>=2:
                key=' '.join(parts[:2])
                if key in lookup: names.add(lookup[key]['latin'])
        if len(counts)<500: return code,names
        offset+=len(counts)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    jobs=[pool.submit(occurrences,code,orders[i:i+15]) for code in catalogue['countries'] for i in range(0,len(orders),15)]
    for done in concurrent.futures.as_completed(jobs):
        code,names=done.result()
        for key in names:
            fish=lookup[key]
            if code not in fish.setdefault('gbif',[]): fish['gbif'].append(code)
for fish in catalogue['species']:
    if fish.get('gbif'):
        fish['gbif'].sort()
        fish['countries']=sorted(set(fish['countries']+fish['gbif']))
apply_checklists(catalogue["species"], json.loads((assets/"europe-checklists.json").read_text()))
path.write_text(json.dumps(catalogue,ensure_ascii=False,separators=(',',':'))+'\n')
print('Country evidence:',sum(bool(f['countries']) for f in catalogue['species']),'species')
