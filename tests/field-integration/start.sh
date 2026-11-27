#!/usr/bin/env bash
# All services bind to the disposable CI environment. No hosted project credentials are used.
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
umask 077
mkdir -p "$stage"
cd "$stage"
supabase init
python3 - <<'PY'
from pathlib import Path
p=Path('supabase/config.toml')
s=p.read_text()
a=s.index('[auth.email]'); b=s.index('\n[',a+1)
email=s[a:b].replace('enable_confirmations = false','enable_confirmations = true')
assert 'enable_confirmations = true' in email
s=s[:a]+email+s[b:]
start=s.index('[auth]'); end=s.index('\n[',start+1)
import re
section=re.sub(r'^additional_redirect_urls\s*=.*$', 'additional_redirect_urls = ["https://milank78git.github.io/angler-to-angler/account/"]',s[start:end],flags=re.M)
assert 'milank78git.github.io/angler-to-angler/account/' in section
p.write_text(s[:start]+section+s[end:])
PY
supabase start -x studio,imgproxy,realtime,edge-runtime,postgres-meta,logflare,vector,supavisor >/dev/null
supabase status -o json > "$stage/local.json"
chmod 600 "$stage/local.json"
cd "$repo"
# Enforce one history and exercise both a first install and an upgrade from the existing pilot.
source tests/field-integration/liquibase.sh
lb validate
lb update-to-tag --tag=pilot-0.18
lb update
python3 tests/field-integration/journal-storage.py configure "$stage"
psql "$url" -Xq -v ON_ERROR_STOP=1 -c "update angler_sync.photo_rollout set started_at=now() where started_at is null"
before=$(psql "$url" -XAtc 'select count(*) from liquibase.databasechangelog')
lb update
after=$(psql "$url" -XAtc 'select count(*) from liquibase.databasechangelog')
[[ "$before" -eq "$after" && "$after" -eq $(($(find supabase/migrations -name '*.sql' | wc -l) + $(grep -c '<tagDatabase ' db/changelog.xml))) ]]
psql "$url" -XAtc "select count(*) from cron.job where jobname='angler-water-directory' and active" | grep -qx 1
psql "$url" -Xq -c "notify pgrst, 'reload schema'"
echo "Database install, upgrade, repeat update and atlas schedule verified."
