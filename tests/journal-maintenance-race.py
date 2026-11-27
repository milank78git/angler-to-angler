"""Save a real journal chunk while the disposable Storage transport is stalled."""
from concurrent.futures import ThreadPoolExecutor
import os
import subprocess
import time

PSQL = ['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1']
# This adult has re-enabled the journal after erasure in the community fixture.
# The photo expiry fixture exercises another account.
OWNER = '00000000-0000-4000-8000-000000000084'
ORPHAN = '00000000-0000-4000-8000-0000000000aa'


def sql(statement, name='journal-race'):
    result = subprocess.run(PSQL, input=statement, text=True, capture_output=True,
                            env=dict(os.environ, PGAPPNAME=name), timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


sql(f"""
    update angler_sync.maintenance_cursor set object_name=null where singleton;
    insert into storage.objects(bucket_id,name,created_at)
      values('angler-journal','{ORPHAN}',now()-interval '3 days');
    insert into angler_sync.chunks(owner,hash,object_id,byte_count,touched)
      values('{OWNER}','slow-storage-fixture',gen_random_uuid(),1,now()-interval '2 days');
    create function storage.wait_for_test_release() returns trigger language plpgsql as $$
    begin
      perform pg_advisory_xact_lock(90427,1);
      return old;
    end $$;
    create trigger delay_delete before delete on storage.objects for each row
      when (old.name='{ORPHAN}') execute function storage.wait_for_test_release();
""")
with ThreadPoolExecutor(max_workers=1) as workers:
    with subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as gate:
        try:
            gate.stdin.write("select pg_advisory_lock(90427,1);\n\\echo READY\n")
            gate.stdin.flush()
            if gate.stdout.readline().strip() or gate.stdout.readline().strip() != 'READY':
                raise RuntimeError('Could not establish storage gate')
            pending = workers.submit(sql, 'select angler_sync.maintain_storage()', 'blocked-storage-worker')
            deadline = time.monotonic() + 8
            while sql("""select exists(select from pg_stat_activity where application_name='blocked-storage-worker'
                          and cardinality(pg_blocking_pids(pid))>0)""") != 't':
                if pending.done():
                    pending.result()
                    raise RuntimeError('Storage worker skipped the test object')
                if time.monotonic() > deadline:
                    raise RuntimeError('Storage worker did not reach the simulated DELETE')
                time.sleep(0.05)
            sql("set statement_timeout='2s'; select angler_sync.maintain()")
            sql(f"""begin; set local statement_timeout='2s'; set local role authenticated;
                set local "request.jwt.claim.sub"='{OWNER}';
                select public.angler_journal_sync('put', jsonb_build_object(
                    'epoch',public.angler_journal_sync('settings','{}')->'epoch',
                    'hash',encode(sha256('concurrent write'::bytea),'hex'),
                    'data',encode('concurrent write'::bytea,'base64')));
                commit;""")
            if sql(f"select exists(select from angler_sync.chunks where owner='{OWNER}' and hash='slow-storage-fixture')") != 'f':
                raise AssertionError('Logical cleanup did not commit during the stalled DELETE')
        finally:
            gate.stdin.close()
            gate.wait(timeout=3)
    pending.result()
if sql(f"select exists(select from storage.objects where name='{ORPHAN}')") != 'f':
    raise AssertionError('Storage worker did not finish the DELETE')
sql('drop trigger delay_delete on storage.objects; drop function storage.wait_for_test_release();')
print('Journal save and quota cleanup committed while Storage DELETE was blocked')
