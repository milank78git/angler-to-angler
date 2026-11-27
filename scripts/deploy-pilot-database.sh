#!/usr/bin/env bash
# Run from the repository root after the release checks on main.
set -euo pipefail
: "${PILOT_DB_HOST:?Set PILOT_DB_HOST to the Supabase session pooler hostname}"
: "${PILOT_DB_PASSWORD:?Set the PILOT_DB_PASSWORD environment secret}"
if [[ ! "$PILOT_DB_HOST" =~ ^[a-z0-9-]+\.pooler\.supabase\.com$ ]]; then
  echo "Expected the Supabase session pooler hostname without a URL or port." >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
export PGHOST="$PILOT_DB_HOST" PGPORT=5432 PGDATABASE=postgres PGUSER=postgres.ybduerxxscdzjktbxchn
export PGSSLMODE=verify-full PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt
if [[ -n "${PILOT_DB_CA:-}" ]]; then
  printf '%s\n' "$PILOT_DB_CA" > "$stage/ca.pem"
  PGSSLROOTCERT="$stage/ca.pem"
fi
export PGCONNECT_TIMEOUT=15 PGPASSWORD="$PILOT_DB_PASSWORD"
export LIQUIBASE_COMMAND_USERNAME="$PGUSER" LIQUIBASE_COMMAND_PASSWORD="$PGPASSWORD"
export LIQUIBASE_COMMAND_URL="jdbc:postgresql://$PGHOST:$PGPORT/$PGDATABASE?sslmode=verify-full&sslrootcert=/certs/pilot.pem&connectTimeout=15"
sql=(psql -Xq -v ON_ERROR_STOP=1)
lb() {
  docker run --rm --network host \
    -v "$PWD:/liquibase/changelog:ro" -w /liquibase/changelog \
    -v "$PGSSLROOTCERT:/certs/pilot.pem:ro" \
    -e LIQUIBASE_COMMAND_URL -e LIQUIBASE_COMMAND_USERNAME -e LIQUIBASE_COMMAND_PASSWORD \
    liquibase/liquibase:4.33.0@sha256:e116c935ba22b59a22165207f65c268e363269de30bb1fedacff3755c2abaa8c \
    --liquibase-schema-name=liquibase --changelog-file=db/changelog.xml "$@"
}

tagged=f
has_history=$("${sql[@]}" -Atc "select to_regclass('liquibase.databasechangelog') is not null")
if [[ "$has_history" == t ]]; then
  tagged=$("${sql[@]}" -Atc "select exists(select from liquibase.databasechangelog where id='hosted-pilot-20261126' and author='angler' and filename='db/changelog.xml')")
fi
if [[ "$tagged" == f ]]; then
  python3 db/pilot/adoption-sql.py > "$stage/repair.sql"
  "${sql[@]}" --single-transaction -v repair_file="$stage/repair.sql" -f db/pilot/adopt.sql
  lb validate
  lb changelog-sync-to-tag --tag=hosted-pilot-20261126
fi
lb validate
lb update
python3 - <<'PY' > "$stage/expected"
from xml.etree import ElementTree
root = ElementTree.parse('db/changelog.xml').getroot()
for c in sorted(root, key=lambda c: c.attrib['id']):
    print('|'.join((c.attrib['id'], c.attrib['author'], root.attrib['logicalFilePath'])))
PY
"${sql[@]}" -Atc "select id||'|'||author||'|'||filename from liquibase.databasechangelog
  where exectype in ('EXECUTED','MARK_RAN','RERAN') and md5sum is not null order by id collate \"C\"" > "$stage/installed"
diff -u "$stage/expected" "$stage/installed"
"${sql[@]}" -c "notify pgrst, 'reload schema'"
echo "Verified $(wc -l < "$stage/installed") pilot changesets."
