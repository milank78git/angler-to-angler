"""Compare the same identity and rating before and after the disposable restore."""
import json
import sys
import time
import urllib.error
import urllib.request
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
