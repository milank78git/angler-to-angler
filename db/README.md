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

Choose the tag matching the verified installation. The pilot-0.18 tag covers the
original 21 migrations. The pilot-0.19 tag also includes water reviews, monthly
group participation and voluntary species counts (24 migrations in total).
Build a reference with `update-to-tag --tag=<tag>` and compare its migration
identifiers, app schemas, functions, grants, policies, cron job and extensions
with the live target. Back up the target. Only for an equivalent installation,
review `changelog-sync-to-tag-sql --tag=<tag>` and apply
`changelog-sync-to-tag --tag=<tag>` before update. For a partially migrated
target, reconcile its actual prefix first.

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

The field-integration workflow additionally dumps Auth and application data
from the disposable stack, creates a fresh local target, installs its schema
with Liquibase and restores the rows. Its acceptance probe signs in with the
original password and checks the same user ID, accepted profile and water
rating. The release job requires this workflow on main. This rehearsal uses
synthetic data and does not touch the pilot database.
