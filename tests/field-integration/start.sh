#!/usr/bin/env bash
# All services bind to the disposable CI environment. No hosted project credentials are used.
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
umask 077
mkdir -p "$stage"
cd "$stage"
supabase init
python3 "$repo/scripts/build-email-templates.py" supabase/templates
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
section=re.sub(r'^additional_redirect_urls\s*=.*$', 'additional_redirect_urls = ["https://horistum.com/account/app.anglers.journal.preview/callback"]',s[start:end],flags=re.M)
assert 'horistum.com/account' in section
import json
subject = Path('supabase/templates/confirmation.subject.txt').read_text().strip()
template = ('\n[auth.email.template.confirmation]\n'
            + 'subject = ' + json.dumps(subject) + '\n'
            + 'content_path = "./supabase/templates/confirmation.html"\n')
p.write_text(s[:start]+section+s[end:]+template)
PY
supabase start -x studio,storage-api,imgproxy,realtime,edge-runtime,postgres-meta,logflare,vector,supavisor >/dev/null
supabase status -o json > "$stage/local.json"
chmod 600 "$stage/local.json"
cd "$repo"
# Enforce one history and exercise both a first install and an upgrade from the existing pilot.
source tests/field-integration/liquibase.sh
lb validate
lb update-to-tag --tag=pilot-0.18
lb update
before=$(psql "$url" -XAtc 'select count(*) from liquibase.databasechangelog')
lb update
after=$(psql "$url" -XAtc 'select count(*) from liquibase.databasechangelog')
[[ "$before" -eq "$after" && "$after" -eq $(($(find supabase/migrations -name '*.sql' | wc -l) + $(grep -c '<tagDatabase ' db/changelog.xml))) ]]
psql "$url" -XAtc "select count(*) from cron.job where jobname='angler-water-directory' and active" | grep -qx 1
psql "$url" -Xq -c "notify pgrst, 'reload schema'"
echo "Database install, upgrade, repeat update and atlas schedule verified."
