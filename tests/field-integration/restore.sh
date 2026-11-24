#!/usr/bin/env bash
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
cd "$stage"
# The only target accepted by this rehearsal is the disposable runner-local project.
[[ "${GITHUB_ACTIONS:-}" == true && -f test-identity.json ]]
container=supabase_db_angler-integration
docker inspect "$container" >/dev/null
umask 077
trap 'rm -f "$stage/test-identity.json" "$stage/rehearsal.dump" "$stage/expected-id"' EXIT
python3 "$repo/tests/field-integration/probe.py" seed "$stage"
docker exec "$container" pg_dump -U supabase_admin -d postgres -Fc --data-only --schema=auth --schema='angler_*' \
  --exclude-table-data=auth.schema_migrations > rehearsal.dump
supabase stop --no-backup >/dev/null
supabase start -x studio,storage-api,imgproxy,realtime,edge-runtime,postgres-meta,logflare,vector,supavisor >/dev/null
supabase status -o json > local.json
cd "$repo"
source tests/field-integration/liquibase.sh
lb update
# Seed catalogues are already in the database dump. Empty the target's data tables together.
docker exec -i "$container" psql -Xq -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare targets text;
begin
  select string_agg(format('%I.%I',schemaname,tablename),',') into targets from pg_tables
    where (schemaname='auth' and tablename<>'schema_migrations') or left(schemaname,7)='angler_';
  execute 'truncate table '||targets;
end $$;
SQL
docker exec -i "$container" pg_restore -U supabase_admin -d postgres --single-transaction --exit-on-error --no-owner \
  --disable-triggers < "$stage/rehearsal.dump"
psql "$url" -Xq -c "notify pgrst, 'reload schema'"
python3 tests/field-integration/probe.py verify "$stage"
