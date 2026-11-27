"""Run against the committed disposable profile database with two live PostgreSQL clients."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
import time

owner = '00000000-0000-4000-8000-000000000085'
digest = '2' * 64

def sql(query, session='photo-race'):
    result = subprocess.run(['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'], input=query,
                            env={**os.environ, 'PGAPPNAME': session}, text=True,
                            capture_output=True, timeout=20, check=False)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

epoch = sql(f"select epoch from angler_sync.accounts where owner='{owner}'")
assert epoch
sql(f"update angler_sync.accounts set erased=false where owner='{owner}'; "
    f"insert into angler_sync.photos(owner,trip,catch_id,digest,object_id,size,expires,attached) "
    f"values('{owner}','trip/race','fish','{digest}',gen_random_uuid(),12,now()+interval '1 day',true)")
cycle = sql(f"select cycle from angler_sync.photos where owner='{owner}' and trip='trip/race'")
payload = json.dumps(dict(trip='trip/race', id='fish', hash=digest, cycle=cycle, epoch=epoch))
renew = (f"set local role authenticated; set local \"request.jwt.claim.sub\"='{owner}'; "
         f"select public.angler_journal_sync('photo_renew','{payload}');")
cleanup = 'select angler_sync.maintain_photos();'

def overlap(holder, competitor):
    with ThreadPoolExecutor() as pool:
        first = pool.submit(sql, 'begin; ' + holder + ' select pg_sleep(2); commit;', 'photo-holder')
        for _ in range(80):
            if sql("select exists(select from pg_stat_activity where application_name='photo-holder' "
                   "and wait_event='PgSleep')") == 't':
                break
            time.sleep(.02)
        else:
            raise AssertionError('The first transaction did not acquire the account lock')
        second = sql('begin; ' + competitor + ' commit;')
        first.result()
        return second

overlap(renew, cleanup)
where = f"owner='{owner}' and trip='trip/race'"
assert sql(f"select expires>now()+interval '11 months' and object_id is not null from angler_sync.photos where {where}") == 't'
sql(f"update angler_sync.photos set expires=now()-interval '1 second' where {where}")
assert json.loads(overlap(cleanup, renew)) == {'expired': True}
assert sql(f"select object_id is null from angler_sync.photos where {where}") == 't'
sql(f"update angler_sync.photos set object_id=gen_random_uuid(),expires=now()-interval '1 second' where {where}")
overlap('select pg_advisory_xact_lock(104809,3);', cleanup)
assert sql(f"select object_id is null from angler_sync.photos where {where}") == 't'
print('Concurrent renewal and expiry retained a valid copy and rejected an expired generation')
