"""Validate the packaged field guide or report upstream changes for human review.

Weekly checks never write fishing rules. The explicit --snapshot option prints candidate
fingerprints for a reviewer to compare with the official text and commit through a PR.
"""
import argparse
from collections import Counter, defaultdict
from functools import lru_cache
import concurrent.futures
import datetime
import hashlib
import html.parser
import json
import re
import os
import sys
import urllib.request
from pathlib import Path

from country_evidence import apply_checklists
from rule_sources import Article, DATA, SourceChanged, published_rules

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'app/src/main/assets'

class VisibleText(html.parser.HTMLParser):
    """Hash visible text, ignoring scripts, analytics attributes and layout markup."""
    def __init__(self):
        super().__init__()
        self.omit = 0
        self.blocks = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.omit += 1
    def handle_endtag(self, tag):
        if tag in ('script','style'): self.omit = max(0,self.omit-1)
    def handle_data(self, text):
        if not self.omit: self.blocks.append(text)

@lru_cache(maxsize=1)
def document_monitors():
    return json.loads(DATA.read_bytes())["documentMonitors"]


def fingerprint(url):
    scope = document_monitors().get(url, {})
    request = urllib.request.Request(scope.get("mirror", url),headers={'User-Agent':'AnglerToAngler/0.15 public source monitor'})
    with urllib.request.urlopen(request,timeout=22) as response:
        body = response.read(20_000_001)
        mime = response.headers.get_content_type()
        encoding = response.headers.get_content_charset() or 'utf-8'
    if len(body)>20_000_000: raise ValueError('response too large')
    if 'html' in mime:
        document = body.decode(encoding, errors='replace')
        if re.search(r'<title[^>]*>\s*(?:Just a moment|Access denied|Checking your browser)', document, re.I):
            raise ValueError('source requires interactive review')
        if 'articleClass' in scope:
            words = Article(scope['articleClass'], exact=scope.get('exact', False), visible_only=True).extract(document)
            if not words:
                raise SourceChanged('Empty authority article')
        else:
            parser = VisibleText()
            parser.feed(document)
            words = ' '.join(' '.join(parser.blocks).split())
            if len(words)<500 or re.search(r'just a moment|enable javascript and cookies to continue|checking your browser',words,re.I):
                raise ValueError('source requires interactive review')
        body=words.encode()
    elif not body.startswith(b'%PDF') and 'json' not in mime:
        raise ValueError('unexpected source representation')
    return hashlib.sha256(body).hexdigest()

def validate():
    data=json.loads((ASSETS/'europe-fish.json').read_text())
    rules=json.loads((ASSETS/'europe-rules.json').read_text())
    countries=set(data['countries'])
    if countries!=set(rules['countries']) or countries!=set(json.loads((ASSETS/'europe-borders.json').read_text())):
        raise ValueError('Country registry and geometry differ')
    names={fish['latin'] for fish in data['species']}
    if len(names)!=len(data['species']): raise ValueError('Duplicate scientific names')
    for fish in data['species']:
        if set(fish['countries'])-countries: raise ValueError(fish['latin'])
    checklists = json.loads((ASSETS / 'europe-checklists.json').read_text())
    if set(checklists) - countries:
        raise ValueError('Unknown checklist jurisdiction')
    projected = [dict(fish, countries=list(fish['countries'])) for fish in data['species']]
    apply_checklists(projected, checklists)
    for raw, checked in zip(data['species'], projected):
        if set(raw['countries']) != set(checked['countries']):
            raise ValueError(f"Country evidence needs reconciliation for {raw['latin']}")
    genera = {name.split()[0] for name in names}
    for rule in rules['entries']:
        if set(rule.get('genera', [])) - genera: raise ValueError(rule)
        if set(rule['species'])-names or rule['country'] not in countries or rule['scope'] not in rules['scopes']:
            raise ValueError(rule)
        if not rule['species'] and not rule.get('genera') and not rule.get('allFreshwater'): raise ValueError(rule)
        if not rules['sources'][rule['source']]['url'].startswith('https://'): raise ValueError(rule)
        for day in rule.get('closed',[])+rule.get('retentionClosed',[]): datetime.date.fromisoformat('2000-'+day)
        for field in ('validFrom','validUntil'):
            if field in rule: datetime.date.fromisoformat(rule[field])
        if 'validFrom' in rule and 'validUntil' in rule and rule['validFrom']>rule['validUntil']:
            raise ValueError(rule)
        if not any(k in rule for k in ('minCm','overCm','maxCm','daily','dailyKg','closed','retentionClosed','permitRequired')):
            raise ValueError(rule)
        if 'maxCm' in rule and rule['maxCm'] < rule.get('minCm',0): raise ValueError(rule)
    return rules

def review_deadlines(rules, catalog, automated):
    reviews = defaultdict(list)
    ends = defaultdict(Counter)
    for key, source in rules['sources'].items():
        if key not in automated:
            reviews[source['reviewBy']].append(key)
    for row in rules['entries']:
        if 'validUntil' in row:
            ends[row['validUntil']][row['source']] += 1
    rows = [(day, f'Source reviews × {len(keys)} ({", ".join(sorted(keys))})') for day, keys in reviews.items()]
    for day, counts in ends.items():
        detail = ', '.join(f'{key} × {n}' for key, n in sorted(counts.items()))
        rows.append((day, f'Rule end dates × {sum(counts.values())} ({detail})'))
    rows.append((catalog['until'], 'local pack review'))
    return sorted(rows)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    options=parser.add_mutually_exclusive_group()
    options.add_argument('--check-sources',action='store_true')
    options.add_argument('--snapshot',action='store_true')
    parser.add_argument('--published', type=Path, help='Verify and inspect the edition served to phones')
    args=parser.parse_args()
    rules=validate()
    if not (args.check_sources or args.snapshot): return
    catalog = json.loads((ASSETS/'catalog.json').read_bytes())
    if args.published:
        edition = published_rules(args.published)
        if not edition:
            raise ValueError('Published atlas lacks signed rule data')
        rules = json.loads(edition['europe-rules.json'])
        catalog = json.loads(edition['catalog.json'])
    today = datetime.date.today()
    automated = set(json.loads(DATA.read_bytes())['sources'])
    deadlines = review_deadlines(rules, catalog, automated)
    horizon = (today + datetime.timedelta(days=90)).isoformat()
    rows = [f'- {day} — {description}' for day, description in deadlines if day <= horizon]
    if rows:
        report = '## Field guide deadlines (next 90 days and overdue)\n\n' + '\n'.join(rows) + '\n'
        print(report, file=sys.stderr)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
                summary.write(report)
    due = any(day <= (today + datetime.timedelta(days=21)).isoformat() for day, _ in deadlines)
    pinfile=ROOT/'data/europe/source-fingerprints.json'
    baseline=json.loads(pinfile.read_text()) if pinfile.exists() else {}
    updated={}
    problems=[]
    today=datetime.date.today().isoformat()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        jobs={pool.submit(fingerprint,source['url']):key for key,source in rules['sources'].items() if not source.get('manualReview') and (args.snapshot or key not in automated)}
        for key,source in rules['sources'].items():
            if source.get('manualReview'):
                print(f'{key}: interactive source review due {source["reviewBy"]}',file=sys.stderr)
                if today>=source['reviewBy']: problems.append(f'{key}: manual review overdue')
        for job in concurrent.futures.as_completed(jobs):
            key=jobs[job]
            try: updated[key]=job.result()
            except (ValueError,OSError) as exc: problems.append(f'{key}: manual source check required ({exc})')
            if updated.get(key) and baseline.get(key)!=updated[key]: problems.append(f'{key}: changed source or new baseline')
            if today>=rules['sources'][key]['reviewBy']: problems.append(f'{key}: review date reached')
    if args.snapshot: print(json.dumps(updated,indent=2,sort_keys=True))
    for text in sorted(problems): print(text,file=sys.stderr)
    if args.check_sources and (problems or due): sys.exit(1)

if __name__=='__main__': main()
