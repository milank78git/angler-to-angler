"""Compare the same identity, rating and unnamed parking point before and after restore."""
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
mode,stage=sys.argv[1],Path(sys.argv[2])
settings=json.loads((stage/'local.json').read_text())
identity=json.loads((stage/'test-identity.json').read_text())
def post(path,args,bearer=None):
    headers={'Content-Type':'application/json','apikey':settings['ANON_KEY']}
    if bearer:
        headers['Authorization']='Bearer '+bearer
    req=urllib.request.Request('http://127.0.0.1:54321'+path,data=json.dumps(args).encode(),headers=headers)
    with urllib.request.urlopen(req,timeout=10) as r:
        return json.load(r)
for attempt in range(20):
    try:
        session=post('/auth/v1/token?grant_type=password',identity)
        profile=post('/rest/v1/rpc/angler_profile',{},session['access_token'])
        break
    except urllib.error.HTTPError:
        if attempt==19:raise RuntimeError('Sign-in or restored profile unavailable') from None
        time.sleep(1)
assert profile['current'] and profile['id']==session['user']['id']
reference=stage/'expected-id'
args={'water_key':'CZ:401009'}
if mode=='seed':
    reference.write_text(profile['id'])
    rating=post('/rest/v1/rpc/angler_water_rate',{**args,'stars':4},session['access_token'])
else:
    assert mode=='verify' and profile['id']==reference.read_text()
    rating=post('/rest/v1/rpc/angler_water_rating',args,session['access_token'])
assert rating['mine']==4 and rating['count']==1
print('Login, profile identity and community rating verified ('+mode+').')


# The API accepts an omitted title and the explicit null sent by the mobile editor.
point_id = str(uuid.uuid5(uuid.UUID(profile['id']), 'unnamed car park'))
point = {**args, 'point_id': point_id, 'expected_revision': 0, 'lat': 49.87654, 'lon': 14.42012}
token = session['access_token']
if mode == 'seed':
    for optional in ({}, {'title': None}, {'title': '   '}):
        saved = post('/rest/v1/rpc/angler_parking_save', {**point, **optional}, token)
        assert saved['id'] == point_id and saved['revision'] == 1

parking = post('/rest/v1/rpc/angler_parking_list', args, token)['points']
matches = [row for row in parking if row['id'] == point_id]
assert len(matches) == 1 and matches[0]['name'] is None
assert (matches[0]['lat'], matches[0]['lon']) == (point['lat'], point['lon'])
print('Unnamed car park verified (' + mode + ').')


# Use an authenticated round trip and compare exact document bytes after a full database restore.
journal_bytes = json.dumps({"version": 1, "value": {"trip": {"id": "restore", "notes": "Morning by the pond"},
    "catches": []}}, separators=(",", ":")).encode()
digest = hashlib.sha256(journal_bytes).hexdigest()

def journal(op, **args):
    return post('/rest/v1/rpc/angler_journal_sync', {'op': op, 'args': args}, token)

if mode == 'seed':
    journal('put', hash=digest, data=base64.b64encode(journal_bytes).decode())
    assert journal('save', key='trip/restore', revision=0, parts=[digest])['revision'] == 1
documents = journal('list')['rows']
assert any(row['key'] == 'trip/restore' and row['parts'] == [digest] for row in documents)
assert base64.b64decode(journal('get', hash=digest)['data']) == journal_bytes
print('Private journal document verified (' + mode + ').')
