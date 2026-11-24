# Database deployment and recovery

Use Liquibase 4.33.0 with a PostgreSQL JDBC connection and a migration account.
The supported target provides Supabase Auth, PostgREST, the anon and authenticated
roles, and the PostgreSQL http and pg_cron extensions. The mobile client reads
the backend URL and publishable key at build time. Provision SMTP, URL allowlists,
TLS and secrets in the target environment.

Create a private schema named liquibase for the deployment account. From the
repository root, set LIQUIBASE_COMMAND_URL, LIQUIBASE_COMMAND_USERNAME and
LIQUIBASE_COMMAND_PASSWORD using the environment's secret manager. Run:

    liquibase --liquibase-schema-name=liquibase --changelog-file=db/changelog.xml validate
    liquibase --liquibase-schema-name=liquibase --changelog-file=db/changelog.xml update

Each changeset references the original SQL file. New migrations must be added
in timestamp order to the same manifest. Use one runner per environment; do
not also apply the same SQL via supabase db push. Check the change log and the
active angler-water-directory cron job after deployment.

## Taking over the existing pilot

The pilot-0.18 tag covers exactly the original 21 migrations. Build a reference
database with update-to-tag --tag=pilot-0.18 first. Compare the migration
identifiers and the actual app schemas, functions, grants, policies, cron job
and extensions with the target. Back up the target. Only if equivalent, review
changelog-sync-to-tag-sql --tag=pilot-0.18 and use changelog-sync-to-tag with the
same tag before update. Never mark the full current manifest as applied. For a
partially migrated target, reconcile against its actual prefix first.

## Transferring existing users and community data

Test a restore of a backup to an isolated compatible target before switching
clients. Preserve Auth users and IDs and the app data together, including
review photos and foreign keys. Restore any separately managed storage, SMTP,
redirects and keys. For a full schema-and-data restore that already includes
Liquibase history, run validate and update on the restored target. Do not run
a schema-creating changeset over restored objects. Reconcile registration,
profile access and two-account authorization before cutover. Offline journals
are local to each installation and are not part of a server dump.

Field integration CI creates a new compatible backend and mailbox. It installs
the tagged schema, upgrades it, runs update again, checks the scheduler and then
registers a user through the installed APK. This is a clean installation and
upgrade rehearsal. A backup containing real operator data requires its own
recovery rehearsal.
