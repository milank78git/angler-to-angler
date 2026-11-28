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

## Automatic hosted pilot deployment

The Android pilot workflow on `main` waits for the database tests, Android registration
and restore, and the published account Pages reader. The `migrate-pilot` job then
runs Liquibase against the hosted database, compares every installed changeset with
the checked-out changelog and reloads the API schema. Signing and publishing the pilot
APK depend on this job succeeding. PRs only use disposable databases. A manual pilot
build from main uses the same gate. Promotion of an already published APK uses its
existing build.

Configure the GitHub Actions environment `pilot-database` for the `main` branch.
Set its secret `PILOT_DB_PASSWORD` to the pilot PostgreSQL password and its variable
`PILOT_DB_HOST` to the hostname from Supabase **Connect → Session pooler**.
The runner fixes the project username and port (5432) and verifies the server's TLS
certificate. If the pooler uses a private root, set the environment variable
`PILOT_DB_CA` to the trusted PEM CA certificate from the Supabase dashboard.
Keep the API, Storage and SMTP credentials in their existing locations.

For the first deployment, have a recoverable backup of the database and private Storage.
The one-time adoption recognizes the 40 historical Supabase ledger entries by version,
name and SQL hash. It checks the live catalog, applies the missing portions of earlier
changes in one transaction, verifies the resulting schema and legacy registration
privileges, and records only the reviewed prefix through `hosted-pilot-20261126`.
It then installs the newer migrations with Liquibase. Existing profiles may receive
the historical nickname disambiguation. The journal and community update invalidates
reusable invitation links. Existing group memberships are retained. Activation of
the new photo format remains a separate rollout step in [the pilot guide](../docs/google-play.md).

After a transient failure, use **Re-run failed jobs** for the same main workflow.
A failed adoption transaction rolls back. A completed adoption can be recognized
again even if the runner stopped before Liquibase recorded it. A different legacy
history or catalog stops the job for review.

## Adopting other historical installations

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

The [function index](functions.md) links each active signature to its effective migration, including renamed implementations. Regenerate it with `python3 scripts/index-db-functions.py` after changing a definition.

## Private journal objects

Before updating the journal migration, provision Supabase Storage and Vault. The migration creates
the private `angler-journal` bucket. In Vault configure `angler_storage_url` with the project's
HTTPS Storage API root ending in `/storage/v1`, and `angler_storage_key` with the server-side Storage
service JWT. Restrict Vault access to the deployment account. Never include this credential in the APK.
New writes store an opaque private object. The five-minute maintenance job reads back each migrated
object and checks its digest before releasing the legacy database bytes. Unreferenced objects are
collected after one day. A 90-day deletion history and a per-account revision boundary protect
returning offline devices from replaying deleted documents.

Back up the private bucket and PostgreSQL together at a consistent recovery point. A SQL dump alone
does not contain object bodies. Restore the bucket with the Storage API and verify the digest of
each referenced object before restarting writers. The field-integration job rehearses this sequence.

Separate five-minute cron transactions run logical cleanup (`angler_sync.maintain()`)
and Storage requests (`angler_sync.maintain_storage()`). A slow Storage request cannot
extend the account lock held by logical cleanup.

Only the app writes objects to the `angler-journal` bucket. Keep manual uploads and folder
placeholders out of it. Maintenance ignores noncanonical object paths. A storage failure leaves
the affected object for another sweep. Check the PostgreSQL log for counts of deferred migrations
and deletions. The account quota follows the logical chunks, independently of physical deletion.

After a PostgreSQL or system collation library upgrade, check for duplicate results of
`angler_private.nickname_key(display_name)` using the new rules. Resolve any collisions with
the account holders, then run the following as the index owner outside a transaction.

```sql
select angler_private.nickname_key(display_name), count(*)
from angler_private.profiles
group by 1 having count(*) > 1;

reindex index concurrently angler_private.profiles_unique_nickname;
```

Check that the rebuilt unique index is valid. If PostgreSQL reports a collation version mismatch,
rebuild all objects affected by that collation before refreshing the recorded version.

The Android journal records each distinct pending save before sending its manifest.
Trip and water-photo checkpoints and pending versions live in the journal's IndexedDB.
Preferences keep theirs in localStorage. A lost response leaves the attempt pending.
The next listing can acknowledge an earlier version even after another local edit.
An ambiguous deletion keeps the surviving journal entry on the phone for an explicit
upload. Adding a favorite again records a new local choice even when its value is identical.

A correction below age 15 erases cloud content and rotates the account epoch. The next
eligible session with the old epoch receives HTTP 410 and clears its sync history while
keeping the offline journal. Opting in again merges the surviving data from each phone
that joins the new epoch, including entries previously removed on another phone.
