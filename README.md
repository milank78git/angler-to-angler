# Angler to Angler

An offline-first Android field journal for anglers. The Czech launcher name is **Rybáři sobě**. Release 0.4.4 is a privately stored journal and a small, sourced pilot catalog. A verified angler profile and acceptance of the current terms are required. Open **My journal** to log a trip on any named water.

## Try the pilot

1. Install the debug APK from the pull request's **Android pilot** workflow artifact. Android 8.0 or later and an up-to-date Android System WebView are required.
2. Enter your email and tap the link on the same phone, or select an enabled social provider. Complete your profile on first sign-in. Operator setup is described in [Accounts](docs/accounts.md). Search for **401 009** or **Sazava**. Open the water, inspect its boundaries and riverside access, and switch species, section and date. Directions open the device's map application.
3. In airplane mode, log a trip. Add multiple catches or keep it as a blank day. A catch can have a locally stored photo, a manual length, bait, technique and an optional private point. Enter the point by hand or explicitly request a current location.
4. Open a saved catch in a trip and choose **Share catch**. The preview starts with just the species. Select the length, date, water, bait, technique or photograph individually and review the result before choosing a recipient. The share sheet sends plain text or the caption and a re-encoded JPEG. Receiving apps control how they use the caption. Coordinates, journal notes, original filenames and image metadata are excluded. A photograph or a deliberately selected water name can still identify a place.
5. Close and reopen the app. Return to **My journal** to see the trip. Deleting a trip also deletes its catches and photos. Uninstalling the application deletes local records.

## Structure and data

- The WebView starts in `app.js`. Navigation owns the lifetime of each screen. The atlas, seasons, trip views and catch editor each import their dependencies explicitly. Only the three native callbacks are exposed on the window.
- Catch sharing uses the system chooser. For a selected photo the chooser receives a read grant for a single randomly named file in the private cache. The provider stops serving copies after 24 hours and cleans up expired files on later use.
- Android supplies the document picker, one-shot location, external map handoff and opt-in seasonal notifications. Packaged web assets run on a fixed, private origin inside the Android application. Native account requests use HTTPS. Journal data stay in the WebView’s private origin and are excluded from backup and analytics. Source links open an external browser.
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

Build the preview first. `bash scripts/android-smoke.sh` runs instrumentation on a disposable **Android 15 test emulator**. It clears the preview application, sets its size and language, selects a water, checks a season, saves two catches, reopens the activity and verifies the records and photo. CI runs both Czech phone and English wide layouts and publishes their screenshots. The emulator also rejects a write, retries it, sends Android Back during a pending write and checks which coordinate field receives focus after invalid input. Unit tests cover navigation history, atomic photo replacement and native alarm scheduling across daylight saving time and pack expiry.


## Interface and preview build

The phone has three primary destinations: Waters, Seasons and Journal. Each remembers its place. At 600 CSS pixels the navigation moves to a side rail. Contextual buttons create trips and catches. The field form keeps species, length and photo immediately visible and groups optional fishing and location details in expandable sections. Favorites, appearance and the journal work offline. The interface follows the system day/night preference until the user chooses a theme.

Design references: [Android adaptive navigation](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns), [Material 3 Expressive research](https://design.google/library/expressive-material-design-google-research), [Android touch targets](https://support.google.com/accessibility/android/answer/7101858), [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [WCAG 2.2 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The two resized offline photographs are credited in the app and in the regional catalog, with links to each original and license. Berounka is by Aktron / Wikimedia Commons, CC BY-SA 3.0. Sázava is by Huhulenik / Wikimedia Commons, CC BY 3.0. The interface includes selected Lucide icons. Their license travels with the APK in `icon-license.txt`.

`bash scripts/build-debug.sh --preview` builds an independently installable sideload preview in `build/preview`. CI debug builds use ephemeral signing keys. The preview uses a separate Android application ID, so testers can keep the original pilot and its private journal on the same device. The standard build retains its original application ID, database schema and storage origin.


## License and governance

Original source is licensed under [Apache 2.0](LICENSE). [NOTICE](NOTICE) covers attribution and third-party materials. The [terms of use](app/src/main/assets/terms-en.txt) and [privacy notice](app/src/main/assets/privacy-en.txt) are also bundled in Czech. See [repository controls](docs/github.md), [contribution guidelines](CONTRIBUTING.md) and [security reporting](SECURITY.md).
