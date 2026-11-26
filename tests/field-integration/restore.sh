#!/usr/bin/env bash
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
cd "$stage"
# The only target accepted by this rehearsal is the disposable runner-local project.
[[ "${GITHUB_ACTIONS:-}" == true && -f test-identity.json ]]
container=supabase_db_angler-integration
docker inspect "$container" >/dev/null
# The local database also requires password authentication over its Unix socket.
# Resolve the password inside the container to keep it out of command arguments and logs.
container_db() {
  docker exec -i "$container" sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"' sh "$@"
}
umask 077
trap 'rm -f "$stage/test-identity.json" "$stage/rehearsal.dump" "$stage/expected-id"' EXIT
python3 "$repo/tests/field-integration/probe.py" seed "$stage"
container_db pg_dump -U supabase_admin -d postgres -Fc --data-only --schema=auth --schema='angler_*' \
  --exclude-table-data=auth.schema_migrations > rehearsal.dump
python3 "$repo/tests/field-integration/journal-storage.py" backup "$stage"
supabase stop --no-backup >/dev/null
supabase start -x studio,imgproxy,realtime,edge-runtime,postgres-meta,logflare,vector,supavisor >/dev/null
supabase status -o json > local.json
cd "$repo"
source tests/field-integration/liquibase.sh
lb update
python3 tests/field-integration/journal-storage.py configure "$stage"
# Drop freshly seeded rows together, including empty dependent tables owned by the local stack.
container_db psql -Xq -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare targets text;
begin
  select string_agg(format('%I.%I',schemaname,tablename),',') into targets from pg_tables
    where (schemaname='auth' and tablename<>'schema_migrations') or left(schemaname,7)='angler_';
  execute 'truncate table '||targets||' cascade';
end $$;
SQL
container_db pg_restore -U supabase_admin -d postgres --single-transaction --exit-on-error --no-owner \
  --disable-triggers < "$stage/rehearsal.dump"
psql "$url" -Xq -c "notify pgrst, 'reload schema'"
python3 tests/field-integration/journal-storage.py restore "$stage"
python3 tests/field-integration/probe.py verify "$stage"
