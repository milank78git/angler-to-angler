# Angler to Angler

An offline-first Android field journal for anglers. The Czech launcher name is **Rybáři sobě**. Release 0.14.0 is a privately stored journal and a small, sourced pilot catalog. A verified angler profile and acceptance of the current terms are required. Open **My journal** to log a trip on any named water.

## Try the pilot

1. Open [GitHub Releases](https://github.com/milank78git/angler-to-angler/releases), select the desired pilot and download the **.apk** under **Assets**. Install it over the previous pilot to retain your private journal. Android 8.0 or later and an up-to-date Android System WebView are required.
2. Create an account with email and password, confirm the email once on the same phone and complete your profile. Next time, unlock with your phone’s fingerprint or screen lock, or sign in with your password. If you previously used email links, choose **Set or reset password** once with the original email. Enabled social providers are also available. Operator setup is described in [Accounts](docs/accounts.md). Search for **401 009** or **Sazava**. Open the water, inspect its boundaries and riverside access, and switch species, section and date. Directions open the device's map application.
3. In airplane mode, log a trip. Add multiple catches or keep it as a blank day. A catch can have a locally stored photo, a manual length, bait, technique and an optional private point. Enter the point by hand or explicitly request a current location.
4. Open a saved catch in a trip and choose **Share catch**. The preview starts with just the species. Select the length, date, water, bait, technique or photograph individually and review the result before choosing a recipient. The share sheet sends plain text or the caption and a re-encoded JPEG. Receiving apps control how they use the caption. Coordinates, journal notes, original filenames and image metadata are excluded. A photograph or a deliberately selected water name can still identify a place.
5. From any saved trip, even one with no catches, choose **Share a trip tip**. Write a fresh message, optionally select the water and date, review the exact text and choose a contact or group in Android. To post it inside the app, choose **Choose a fishing group**, select the group and tap **Post tip to group**. Read recent and older tips under **Fishing groups → group name → Group tips**. Group posting and reading require an online account. You can also add a tip to a catch card for external sharing.
6. Open **Profile → Account and group settings → Fishing groups** while online. Create a group, open its name and issue an invitation. Send the code to one angler. They can paste it under **Join with a code**. Each new code replaces the previous code and expires after 24 hours. Members can leave and the owner can dissolve the group.
7. Close and reopen the app. Return to **My journal** to see the trip. Deleting a trip also deletes its catches and photos. Uninstalling the application deletes local records.

8. Under **Profile → Edit profile**, choose one of 50 bundled portraits or a personal picture, enter your hometown, tagline and biography, and optionally publish to signed-in anglers. The card shows your groups and the number of photo-documented catches.
9. To document a catch, use **Photograph catch at the water** while at the water, then submit the saved catch from its trip. Check the outcome or withdraw the record under **Profile → My submitted catch photos**. The result distinguishes a length read from a ruler from an estimate based on a known-size reference. Only reviewed catches with either outcome count. Gallery photos and manually entered lengths can be kept in the journal.

10. In the atlas, open a water and choose **Observations and questions**. Share a local observation, ask a question or open one to post a free answer. You can include the date you fished. The question author can mark another angler’s answer as helpful. Use **Reply to this post** for a follow-up. It shows the author and an excerpt of the original answer. You can withdraw your own text until it receives a text reply. Participants can report a post for moderation.

11. Open another angler’s question and choose **Reply privately**. Confirm the recipient and text. Both anglers can continue under **Profile → Private messages**. Use **Insert emoji** in a draft or type with your Android keyboard. Under a sent or received message, choose **React** to add a quick or keyboard emoji. You can replace or remove your reaction. Either can block further messages across waters or report an individual received message.

12. From a photographed catch in the journal, choose **Enter catch of the week**, select a fishing group and confirm its preview. Members can open **Profile → Group catch of the week** or go directly from their group. Each account can vote once per other catch. Ties share a rank. Rounds run Monday through Sunday in Prague time. Past rounds are available from the board.

13. From a completed journal trip on a catalog water choose **Trip contribution**. Review the whole water, month, target species, main method and total recorded fish before confirming. Blank trips are included. Manage snapshots independently of local entries under **Profile → My activity contributions**. Under **Waters → water name → Water activity**, select a calendar month and optional filters. The success fraction describes only contributed trips and appears when the sample includes a blank trip.

14. From a saved catch choose **Public catch card**. The preview includes the fish species, display name and catch month. Exact day, an enabled catalog water, photo and reviewed length are individual choices. Confirm to create a link. Anyone who has the link can open it in a browser. Under **Profile → My public cards**, share or revoke a link even after deleting the trip from the phone.

15. Open **Profile → Tip market** to browse fishing techniques. Publishing from a journal trip copies only its date into the form. Review the public preview and enter the written instructions separately. An account may claim 100 test credits once. Unlocking requires a separate confirmation at the displayed price. **Purchased tips** keeps the agreed version after a price change or withdrawal. The pilot has no cash payments, top-ups or payouts.

16. In **Purchased tips**, open a technique and choose **Rate purchased tip**. Score its accuracy, technique description and match with the preview from 1 to 5. Review the three scores before confirming. Each purchase contributes once to the author’s average, including after edits or withdrawal. Verified anglers see the average and rating count before buying. The author’s profile also shows the averages by criterion.

## Structure and data

- The WebView starts in `app.js`. Navigation owns the lifetime of each screen. The atlas, seasons, trip views and catch editor each import their dependencies explicitly.
- Catch sharing uses the system chooser. For a selected photo the chooser receives a read grant for a single randomly named file in the private cache. The provider stops serving copies after 24 hours and cleans up expired files on later use.
- Android supplies the document picker, one-shot location, external map handoff and opt-in seasonal notifications. Packaged web assets run on a fixed, private origin inside the Android application. Native account requests use HTTPS. Journal data stay in the WebView’s private origin and are excluded from backup and analytics. Source links open an external browser.
- IndexedDB keeps trip, catch and image records. A catch and its re-encoded JPEG are committed in a single transaction. Images are resized to a maximum edge of 1,920 pixels and omit source metadata. Saved lengths use integer millimetres. GPS records distinguish angler position from strike location, provider accuracy and observation time.
- The 2026 Czech pack contains two main-river reaches and four species. It has a country, IANA time zone, revision, inclusive validity period, scientific names, regional sizes, closed seasons and primary sources. A restricted section returns a prohibition. An unknown section or expired pack returns an unknown status. Local seasonal results cover the selected rule only. The app UI is available in Czech and English, following the device language.
- Reminders apply to the selected water and species. Android schedules approximate local 08:00 notifications on a seasonal transition and on the day after pack expiry. Restart and package replacement reschedule active subscriptions. If notifications are disabled, the app can still be used offline.
- The APK includes the complete pilot pack. Updates currently ship with a new APK. The map shows generalized river geometry, boundaries, selected restrictions and documented accesses. Check public access locally. A boundary point does not imply an access point.
- International expansion should add regional packs, local authorities, languages and corresponding rule tests. The first pilot ships one pack. Unlisted waters work worldwide as user-named journal entries.
- Paid location tips, payouts, rankings, document verification and automated photo measurement belong to later releases. A future competition, record claim or prize would need a separate evidence standard, such as a continuous in-app clip with a randomized camera movement.

## Daily water directory

The offline atlas includes the published ČRS and MRS directories. The waters come with links to their official cards. A country filter and an on-device location search also cover the Montana pilot. On Czech waters the app measures approximate distance to a generalized RIS outline or the nearest published location. An unlocated water remains searchable by name or number. The original Berounka and Sázava entries retain their journal IDs, local seasons and map details.

The daily workflow checks the upstream sources at 05:15 UTC. It keeps the last good edition of an unavailable register and reports failures in Actions. Changed data is published on the public `water-atlas-v1` branch. A Supabase Cron job checks the small manifest every 30 minutes and registers new keys before announcing that edition to phones. Historical keys remain valid for existing reports, posts and offers. Apply the included migrations in order to the pilot database and enable Actions writes to this branch. The initial publication runs on merge or manual dispatch from main.

Open **Water atlas updates** in the atlas or account settings. Automatic checks default to daily and require connectivity. Android can defer background work. Opening the app catches up, and **Check now** also works with automatic checks disabled. A phone verifies the SHA-256 and size of its download before switching editions. No APK upgrade is needed for later data releases.

The country selector covers all 51 European jurisdictions in the field guide. Offline data includes Czech union waters, Slovak union permit lists, Berlin water polygons, Northern Ireland's Public Angling Estate, Irish accessible angling sites, Swedish fishery management area reference points, Luxembourg fishing sections and Portuguese mainland concessions. Each source retains its identity, scope and edition date. Other countries link to available directories or national fishing information. Always check the publisher for current access and restrictions.

Run the Czech importer locally with Python 3 and GDAL. Use a fresh cache directory to fetch a new snapshot, or omit `--download` to reproduce a snapshot from the same inputs.

```sh
/usr/bin/python3 scripts/import-czech-waters.py ./water-cache --download --as-of YYYY-MM-DD --sql ./candidate.sql
```

The importer matches source record IDs, keeps distinct waters that share a number and preserves past discussion targets. ČRS outlines use S-JTSK (EPSG:5514), simplified at 35 metres before conversion to WGS84. MRS points come from named locations and active parts of the fishery. Source pages provide current access and fishing conditions.

## Sources

Water facts are individually summarized from the official cards for [Berounka 1](https://www.rybsvaz.cz/karta-reviru/-/401001-berounka-1-h) and [Sázava 1](https://www.rybsvaz.cz/karta-reviru/-/401009-sazava-1-h). National seasons come from the [Ministry of Agriculture, § 13](https://mze.gov.cz/public/portal/mze/legislativa/vap57781-6415). The Sázava access point is documented by [Posázaví](https://tourist.posazavi.com/cz/Service/Service.aspx?Id=1235). The pack was reviewed on 2026-11-23 and expires on 2026-12-31.

The bundled river geometry in `app/src/main/assets/rivers.json` is © OpenStreetMap contributors, available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Source waterway relations are [Berounka](https://www.openstreetmap.org/relation/1768356) and [Sázava](https://www.openstreetmap.org/relation/1772080). Download their full OSM XML and run `python3 scripts/extract-rivers.py berounka.xml sazava.xml app/src/main/assets/rivers.json` to regenerate the cropped linework. The geometry describes the rivers, not legal fishery boundaries.

## Build and verify

Use a JDK 17 or 21, Node.js 22+, Android SDK Platform 35, Build Tools 35.0.0, and zip. Set `ANDROID_HOME` to the SDK directory. The standalone build uses stock Android tools, generates a local Android debug key if needed, and checks the signature of the finished APK.

```sh
npm ci --ignore-scripts
npm test
bash scripts/build-debug.sh
adb install -r build/standalone/angler-journal-debug.apk
```

Open the project in Android Studio with Gradle 8.9 for IDE development. The standalone build and CI do not require Gradle or application dependencies.

Build the preview first. `bash scripts/android-smoke.sh` runs instrumentation on a disposable **Android 15 test emulator**. It clears the preview application, sets its size and language, selects a water, checks a season, saves two catches, reopens the activity and verifies the records and photo. CI runs both Czech phone and English wide layouts and publishes their screenshots. The emulator also rejects a write, retries it, sends Android Back during a pending write and checks which coordinate field receives focus after invalid input. Unit tests cover navigation history, atomic photo replacement and native alarm scheduling across daylight saving time and pack expiry.


## Interface and preview build

The phone has three primary destinations: Waters, Seasons and Journal. Each remembers its place. At 600 CSS pixels the navigation moves to a side rail. Contextual buttons create trips and catches. The field form keeps species, length and photo immediately visible and groups optional fishing and location details in expandable sections. Favorites, appearance and the journal work offline. The interface follows the system day/night preference until the user chooses a theme.

Design references: [Android adaptive navigation](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns), [Material 3 Expressive research](https://design.google/library/expressive-material-design-google-research), [Android touch targets](https://support.google.com/accessibility/android/answer/7101858), [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [WCAG 2.2 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The profile picker includes 50 original illustrated angler portraits bundled in a single WebP image. The two resized offline photographs are credited in the app and in the regional catalog, with links to each original and license. Berounka is by Aktron / Wikimedia Commons, CC BY-SA 3.0. Sázava is by Huhulenik / Wikimedia Commons, CC BY 3.0. The interface includes selected Lucide icons. Their license travels with the APK in `icon-license.txt`.

`bash scripts/build-debug.sh --preview` builds an independently installable sideload preview in `build/preview`. CI debug builds use ephemeral signing keys. The preview uses a separate Android application ID, so testers can keep the original pilot and its private journal on the same device. The standard build retains its original application ID, database schema and storage origin.


## License and governance

Original source is licensed under [Apache 2.0](LICENSE). [NOTICE](NOTICE) covers attribution and third-party materials. The [terms of use](app/src/main/assets/terms-en.txt) and [privacy notice](app/src/main/assets/privacy-en.txt) are also bundled in Czech. See [repository controls](docs/github.md), [contribution guidelines](CONTRIBUTING.md) and [security reporting](SECURITY.md).
