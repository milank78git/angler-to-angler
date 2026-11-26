# Pilot audit findings N1–N19

The status below describes the source in this pull request. Database changes, Edge Functions, publication keys and released APKs have separate deployment lifecycles.

| ID | Behaviour in this revision | Verification |
| --- | --- | --- |
| N1 | Camera and share results have distinct request codes. | The Android result dispatcher routes camera and share completion separately. |
| N2 | Account JSON responses have a 256 KiB byte limit, including single-line responses. | IdentityService checks each input block before writing it. |
| N3 | A discussion response without the requested root shows an unavailable-thread screen and suppresses the reply action. | DOM tests cover a missing root, a mismatched root and reopening a valid thread. |
| N4 | The marketplace editor and the database resolve the calendar day in the selected water's zone. Private locations use the device zone. Legacy submissions without a water or zone keep the historical default. | The database suite exercises dates on opposite sides of the international date line and a conflicting client zone. |
| N5 | Seasonal notifications are private on the lock screen and generic when account verification has expired. | Android notification scenario. |
| N6 | A callback arriving during an account request is retained and processed when the screen can handle it. | Account and callback activity paths, including mail handoff. |
| N7 | WebView startup errors log the failure class while the screen offers recovery. | Startup error handler in app.js. |
| N8 | The Gradle wrapper builds the pilot, preview and Play variants. The manifest supplies the version name and default code. Gradle supplies the SDK levels and namespace. | APK and AAB workflows use the wrapper. |
| N9 | A scheduled refresh writes candidate data into the publication workspace. | The offline release and per-provider failure tests compare successive editions. |
| N10 | The importer discovers the Swedish portal's production map service, pages the active layer and reconciles journal IDs with the previous edition. An incomplete response retains the last good edition. | Provider identity fixtures cover duplicates, moves and renames. |
| N11 | The publisher signs the immutable edition, and downloaded atlases require a signature from the key pinned in the APK. A device without a trusted edition can use the bundled atlas. | CLI tests change each signed field and the key. Android exercises the signed download. Configure the publisher and publish the first signed manifest before distributing the new APK. |
| N12 | Each public aggregate requires at least ten trips and five contributors with independently reviewed catch evidence. This also applies to ranked waters and species. | PostgreSQL tests keep all three projections hidden for unreviewed accounts and expose qualifying cohorts. These checks establish review history, not civil identity. |
| N13 | The authenticated Play push handler acknowledges permanent failures and requests redelivery for transient failures. | Receipt tests cover malformed input, an unavailable publisher API and pending purchases. The production dead-letter subscription and IAM require a delivery test in the operator's Google Cloud project. |
| N14 | A unique database index enforces normalized display names. Existing collisions receive a stable suffix and preserve their original spelling in the private profile. | The SQL suite covers existing collisions, an occupied suffix, duplicate registration and reacceptance. |
| N15 | The display layer sanitizes HTML fragments. Localized attributes escape quotes, and dictionary validation rejects embedded tags. | DOM markup tests and the locale validation run in CI. |
| N16 | CI runs type checking across the first-party JavaScript and exercises profile-editor buttons on Android. Discussion-root regression tests also render the screen and inspect its actions. | TypeScript navigation contract, Android editor retry/cancel flows and discussion DOM tests. |
| N17 | The account activity is private. The public launcher opens it with a fresh intent. External authentication links enter through the validating callback activity. | Android account registration, mail return and launcher re-entry scenarios. |
| N18 | Expired account verification produces one generic seasonal prompt per local day across watches, including after dismissal. | The emulator checks duplicate watches, dismissal and the following day. |
| N19 | The marketplace estimate states its paid-credit assumption and explains welcome credits, mixed payments and final settlement. | Compare the estimate copy with funded-share wallet tests. |
