"""Compare the same identity, rating and unnamed parking point before and after restore."""
import base64
import hashlib
import json
import sys
import subprocess
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
jpeg = b'\xff\xd8\xff' + bytes(range(256)) * 330 + b'\xff\xd9'
photo_hash = hashlib.sha256(jpeg).hexdigest()
photo = dict(trip='trip/restore', id='fish', hash=photo_hash)
journal_bytes = json.dumps({"version": 2, "value": {"trip": {"id": "restore", "notes": "Morning by the pond"},
    "catches": [{"record": {"id": "fish", "tripId": "restore", "hasPhoto": True}, "photoHash": photo_hash}]}},
    separators=(",", ":")).encode()
digest = hashlib.sha256(journal_bytes).hexdigest()

def journal(op, **args):
    return post('/rest/v1/rpc/angler_journal_sync', {'op': op, 'args': args}, token)

if mode == 'seed':
    journal('enable')
    for start in range(0, len(jpeg), 65536):
        journal('photo_part', **photo, part=start//65536, data=base64.b64encode(jpeg[start:start+65536]).decode())
    journal('photo_prepare', **photo)
    journal('put', hash=digest, data=base64.b64encode(journal_bytes).decode())
    assert journal('save', key='trip/restore', revision=0, format=2, parts=[digest])['revision'] == 1
documents = journal('list', format=2)['rows']
assert any(row['key'] == 'trip/restore' and row['parts'] == [digest] for row in documents)
assert base64.b64decode(journal('get', hash=digest)['data']) == journal_bytes
restored = b''.join(base64.b64decode(journal('photo_get', **photo, offset=n)['data']) for n in range(0,len(jpeg),65536))
assert restored == jpeg
print('Private journal document verified (' + mode + ').')


# The owner's private profile survives the same backup as their identity and journal.
details_args = {'age': 48, 'expiry': '2030-03-31', 'reminder': 'month', 'revision': 0}
details_rpc = '/rest/v1/rpc/angler_my_details'
if mode == 'seed':
    post(details_rpc, {'changes': details_args}, token)
assert post(details_rpc, {}, token) == {**details_args, 'revision': 1}
print('Private age, licence and reminder verified (' + mode + ').')


# Advance only this restored fixture to its first expiry. Verify the real Storage API
# purges its object and that a fresh authenticated client still reads the catch metadata.
if mode == 'verify':
    owner = str(uuid.UUID(profile['id']))
    predicate = f"owner='{owner}' and trip='trip/restore' and catch_id='fish' and digest='{photo_hash}'"

    def fixture_sql(query):
        return subprocess.check_output(['psql', settings['DB_URL'], '-XqAt', '-v', 'ON_ERROR_STOP=1'],
                                       input=query, text=True).strip()

    object_id = str(uuid.UUID(fixture_sql(f"select object_id from angler_sync.photos where {predicate}")))
    cycle = str(uuid.UUID(fixture_sql(f"select cycle from angler_sync.photos where {predicate}")))
    stored = f"bucket_id='angler-catch-photos' and name='{object_id}'"
    assert fixture_sql(f"select count(*) from storage.objects where {stored}") == '1'
    fixture_sql(f"update storage.objects set created_at=now()-interval '12 months' where {stored};"
                f"update angler_sync.photos set expires=now()-interval '1 second' where {predicate};")
    assert journal('photo_get', **photo, offset=0) == {'expired': True}
    assert journal('photo_renew', **photo, cycle=cycle) == {'expired': True}
    for _ in range(5):
        fixture_sql('select angler_sync.maintain_photos()')
        if fixture_sql(f"select count(*) from storage.objects where {stored}") == '0':
            break
        time.sleep(1)
    else:
        raise AssertionError('Expired object still present after Storage maintenance')
    assert journal('photo_need', **photo) == {'needed': False}
    assert base64.b64decode(journal('get', hash=digest)['data']) == journal_bytes
    print('Expired Storage object removed; journal metadata and expiry marker preserved.')
