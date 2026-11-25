# Czech Play internal test and settlement

The project now has a pilot APK and a Google Play AAB with package name
`app.anglers.journal`. The marketplace starts disabled. A separate Supabase
project is required for license testers. Once its store is activated, the
database rejects switching between test and live financial environments.

## Prepare an internal release

1. Register the Play Console account, complete verification and the merchant
   payments profile, and create the listing under the existing package name.
   Choose the Play signing identity deliberately. Existing sideloaded pilots
   can update in place only if their installed signing certificate matches.
   Confirm the journal shows a completed sync and verify a restore before asking anyone to reinstall.
2. Set the public GitHub Actions variable `ANGLER_PLAY_ACCOUNT_CONFIG` for the
   test project using the format in `docs/accounts.md`. Configure the Pages
   callback there. Apply the Liquibase changelog. Deploy the `play-purchase`
   Edge Function and configure Supabase Auth JWT verification as described below.
   Create a Google service account, enable Android Publisher API, grant the
   application-scoped order permissions needed for verification, consumption
   and voided purchases. Put its JSON in the Edge secret
   `PLAY_SERVICE_ACCOUNT_JSON`; set `PLAY_PURCHASE_MODE=test`.
3. In the isolated database, run
   `update angler_commerce.settings set mode='test'`. The account receives
   10 one-time promotional credits. The ledger grants them on profile
   creation; all spending and purchases require a verified member.
4. Download the Google Play bundle workflow artifact. The workflow builds a
   release AAB and never uploads it to a store. Sign it with the designated
   upload key (use jarsigner with an interactive password prompt), verify the
   signature with jarsigner, and upload it to internal testing. A bundle built
   without public account configuration is a build check only. Use the same
   application ID, an increasing version code and the correct upload key.
5. Create consumable one-time products `credits_50_czk` and `credits_100_czk`,
   with one standard buy option each, quantity one and no discounts. Set the
   Czech tax-inclusive prices to CZK 50 and CZK 100. Restrict distribution to
   Czechia for this release. Only matching CZK prices are offered in the client.
6. Add license testers and internal testers, then use the Play installation
   link. Verify approved, declined, pending and canceled purchases, restart,
   offline delivery and a developer refund with two different app accounts.
   Compare the quoted and charged price, wallet grant, single consumption and
   Google order. Test receipts must never create a bank instruction.

Deploy `supabase functions deploy play-purchase --no-verify-jwt` to the intended
project. The function verifies the mobile bearer with Supabase Auth. Its separate
push route verifies Google's OIDC signature, issuer, audience and verified
service-account email. Both paths check the Google purchase V2 record, product,
quantity, region, environment and account before crediting, then consume it.

In Play Console enable real-time developer notifications for one-time products,
grant Google Play permission to publish to the chosen Pub/Sub topic, and create
an authenticated push subscription to the Edge URL ending in
`/functions/v1/play-purchase/notifications`. Configure `PLAY_PUSH_EMAIL` for the
push service account, `PLAY_PUSH_AUDIENCE` for its exact OIDC audience and
`PLAY_PUSH_SUBSCRIPTION` for the full subscription resource name. Use the Console
test message, then complete a pending license purchase with the app closed.
Review retry and dead-letter messages for the subscription. Daily refund polling
also covers missed void notifications.

## Operating the marketplace

Pilot tips can be enrolled by their author on their detail screen. Earlier
buyers keep their entitlements. New Play purchases use a separate ledger.
The ten promotional credits can unlock tips and have zero monetary value for
all three recipients. A welcome-only unlock is available on unlimited offers
and does not count as a sale or qualify for a commercial rating. For a limited
offer at least one purchased credit is required. The confirmation shows the
split before checkout. Mixed purchases distribute only the paid portion.
Existing buyers keep their purchased revisions, including welcome-only copies.
The migration stops if a live ledger has historical sponsored allocations.
Reconcile existing commitments and bank instructions before changing that ledger.
Purchased packs have no settled monetary value until the earnings statement
is reconciled. Prices and splits are CZK-only in this release.

Use a private Python environment with psycopg 3, google-auth and requests;
database access uses a restricted operator connection via libpq. Keep recipient
verification and bank details with the chosen payout provider. Store only its
verified destination reference in `angler_commerce.recipients`. Identify the
conservation beneficiary before opening live sales.

- Run `python scripts/play/voids.py` daily with Google application default
  credentials, database access and `PLAY_PURCHASE_MODE` matching the database.
  The first pass checks the past 29 days. Later runs overlap and page forward.
- Run `python scripts/play/settlement.py import-earnings earnings.csv` on the
  complete English Play monthly earnings export with merchant currency CZK.
  The importer sums signed charge, tax and fee rows per Google order. Verify
  totals against the actual remittance. Unsupported adjustments and partial
  refunds require reconciliation before release of the affected payout.
- Payouts require CZK 100 settled earnings and three currently published
  enrolled offers for the first payout. Requests reserve funds. Export a
  closed month with `payout-batch YYYY-MM-01`. Review verified destinations
  and use the payout UUID as the unique bank instruction reference. Re-export
  returns the same identifiers and bank confirmation status. After bank
  confirmation run `record-paid PAYOUT_UUID BANK_REFERENCE`. Export and
  confirmation are available only on the live ledger.
- Run `nature-balance` for allocated, sent and remaining CZK. Confirm an
  actual transfer using `record-nature BANK_REFERENCE PARTNER HALERS YYYY-MM-DD`.
  The five percent applies to settled proceeds from spent, purchased credits. Refunds also reverse allocations.
- Reconcile a late refund even if the author's payout already cleared.
  The balance then offsets future earnings. Review any negative carry before
  paying again. The app never initiates a bank transfer.

## Listing materials

Use the published GitHub Pages privacy and account-deletion pages under
`/angler-to-angler/privacy/` and `/angler-to-angler/delete-account/`.
Describe optional exact catch location, photos, personal journal content,
identity, community features and purchase history in the Play data safety
questionnaire according to the configured providers and retention policy.
Complete the audience, content rating, reviewer access and store listing in
Play Console. Do not promote from internal testing until the real checkout,
restoration, refunds and settlement evidence have been reviewed.

## Portable private journal

Android and future clients use the same versioned, authenticated document
format. The Android APK and the Play bundle retain offline IndexedDB storage.
New registrations disclose account storage and turn on private synchronization for a fresh journal. Existing device journals require a separate opt-in before historical GPS coordinates and photos leave the phone. A clean second device restores after sign-in once the account has synced. A device with existing private records asks before combining journals.
A revision covers one trip and its catches, a personal water photo or a
preference. Disjoint edits merge. Conflicting edits to one document require
an explicit local/cloud choice. Account deletion cascades through private
documents and media. OS permissions and delivery of notifications are local.


The Journal screen shows whether edits are on this device or synchronized with
the account. It retains the time of the last successful transfer when offline or
after a service error. Use **Sync now** to retry. If both installations change
the same trip, review its fishing date and water before choosing a version.
