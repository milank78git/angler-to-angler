"""Import CC0 Wikidata labels by exact scientific species name, keeping country data independent."""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
assets=root/"app/src/main/assets"
args=argparse.ArgumentParser()
args.add_argument("--names",type=Path,default=assets/"europe-fish.json")
args.add_argument("--cache",type=Path,required=True)
cfg=args.parse_args()
source=json.loads(cfg.names.read_text())
names=sorted({f["latin"] for f in source["species"]})
langs="en cs sk de fr pl es it uk nl pt ro hu el sv fi da bg hr sl lt lv et ga ru sr tr is sq bs mk hy ka az be lb cy gd gl ca br fy ast oc kk yi nb nn mt eu fo rm se".split()
known=json.loads(cfg.cache.read_text()) if cfg.cache.exists() else {}
missing=[n for n in names if n not in known]
for pos in range(0,len(missing),24):
    batch=missing[pos:pos+24]
    literal=" ".join(json.dumps(n,ensure_ascii=False) for n in batch)
    languages=",".join(json.dumps(l) for l in langs)
    query=('SELECT DISTINCT ?name ?label WHERE { VALUES ?name { '+literal+' } '
           '?taxon wdt:P225 ?name; wdt:P105 wd:Q7432; rdfs:label ?label . '
           'FILTER(LANG(?label) IN ('+languages+')) }')
    uri="https://query.wikidata.org/sparql?"+urllib.parse.urlencode({"query":query,"format":"json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(uri,headers={"User-Agent":"AnglerToAngler/0.15 fish dictionary"}),timeout=55) as res:
                rows=json.load(res)["results"]["bindings"]
            break
        except (OSError,ValueError):
            if attempt==2: raise
            time.sleep(3*(1+attempt))
    for name in batch: known[name]={}
    for row in rows:
        name=row["name"]["value"]; val=row["label"]["value"]; lang=row["label"]["xml:lang"]
        if name in batch and val.casefold()!=name.casefold() and len(val)<=90:
            known[name].setdefault(lang,val)
    cfg.cache.write_text(json.dumps(known,ensure_ascii=False))
    time.sleep(.8)
for lang in langs:
    labels={n:known[n][lang] for n in names if lang in known.get(n,{})}
    (assets/("fish-names-"+lang+".json")).write_text(json.dumps(labels,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n")
print(len(names),"scientific names processed")
