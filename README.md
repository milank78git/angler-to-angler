# Angler to Angler

An offline-first Android field journal for anglers. The Czech launcher name is **Rybáři sobě**. Release 0.2.0 is a privately stored journal and a small, sourced pilot catalog. Use the search, water detail and season selector without an account. Open **My journal** to log a trip on any named water.

## Try the pilot

1. Install the debug APK from the pull request's **Android pilot** workflow artifact. Android 8.0 or later and an up-to-date Android System WebView are required.
2. Search for **401 009** or **Sazava**. Open the water, inspect its boundaries and riverside access, and switch species, section and date. Directions open the device's map application.
3. In airplane mode, log a trip. Add multiple catches or keep it as a blank day. A catch can have a locally stored photo, a manual length, bait, technique and an optional private point. Enter the point by hand or explicitly request a current location.
4. Close and reopen the app. Return to **My journal** to see the trip. Deleting a trip also deletes its catches and photos. Uninstalling the application deletes local records.

## Structure and data

- Android supplies the document picker, one-shot location, external map handoff and opt-in seasonal notifications. Packaged web assets run on a fixed, private origin inside the Android application. It has no internet permission, accounts, backup, server or analytics. Source links open an external browser.
- IndexedDB keeps trip, catch and image records. A catch and its re-encoded JPEG are committed in a single transaction. Images are resized to a maximum edge of 1,920 pixels and omit source metadata. Saved lengths use integer millimetres. GPS records distinguish angler position from strike location, provider accuracy and observation time.
- The 2026 Czech pack contains two main-river reaches and four species. It has a country, IANA time zone, revision, inclusive validity period, scientific names, regional sizes, closed seasons and primary sources. A restricted section returns a prohibition. An unknown section or expired pack returns an unknown status. Local seasonal results cover the selected rule only. The app UI is available in Czech and English, following the device language.
- Reminders apply to the selected water and species. Android schedules approximate local 08:00 notifications on a seasonal transition and on the day after pack expiry. Restart and package replacement reschedule active subscriptions. If notifications are disabled, the app can still be used offline.
- The APK includes the complete pilot pack. Updates currently ship with a new APK. The map shows generalized river geometry, boundaries, selected restrictions and documented accesses. Check public access locally. A boundary point does not imply an access point.
- International expansion should add regional packs, local authorities, languages and corresponding rule tests. The first pilot ships one pack. Unlisted waters work worldwide as user-named journal entries.
- Community groups, paid location tips, payouts, rankings, document verification and automated photo measurement belong to later releases.

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

`bash scripts/android-smoke.sh` runs an instrumentation test on a connected **test device**. It clears the application's data on that device, selects a water, checks a season, saves two catches, restarts the activity and verifies the persisted catch list. CI runs this on a fresh emulator. The storage regression suite also checks retrying a save, deleting associated photos and rejecting an orphaned catch.


## Interface and preview build

The phone has three primary destinations: Waters, Seasons and Journal. Each remembers its place. At 600 CSS pixels the navigation moves to a side rail. Contextual buttons create trips and catches. The field form keeps species, length and photo immediately visible and groups optional fishing and location details in expandable sections. Favorites, appearance and the journal work offline. The interface follows the system day/night preference until the user chooses a theme.

Design references: [Android adaptive navigation](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns), [Material 3 Expressive research](https://design.google/library/expressive-material-design-google-research), [Android touch targets](https://support.google.com/accessibility/android/answer/7101858), [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [WCAG 2.2 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The two resized offline photographs are credited in the app and in the regional catalog, with links to each original and license. Berounka is by Aktron / Wikimedia Commons, CC BY-SA 3.0. Sázava is by Huhulenik / Wikimedia Commons, CC BY 3.0. The interface includes selected Lucide icons. Their license travels with the APK in `icon-license.txt`.

`bash scripts/build-debug.sh --preview` builds an independently installable sideload preview in `build/preview`. CI debug builds use ephemeral signing keys. The preview uses a separate Android application ID, so testers can keep the original pilot and its private journal on the same device. The standard build retains its original application ID, database schema and storage origin.
