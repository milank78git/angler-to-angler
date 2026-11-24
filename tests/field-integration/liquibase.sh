# Source from the repository root with repo and stage set by the caller.
url=$(jq -er .DB_URL "$stage/local.json")
psql "$url" -Xq -v ON_ERROR_STOP=1 -c 'create schema if not exists liquibase'
lb() {
  docker run --rm --network host -v "$repo:/liquibase/changelog:ro" -w /liquibase/changelog liquibase/liquibase:4.33.0 \
    --url=jdbc:postgresql://127.0.0.1:54322/postgres --username=postgres --password=postgres \
    --liquibase-schema-name=liquibase --changelog-file=db/changelog.xml "$@"
}
