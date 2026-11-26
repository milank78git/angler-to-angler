# Repository controls

The active [Protect main ruleset](https://github.com/milank78git/angler-to-angler/settings/rules/27878561) applies to the default branch. Changes require a pull request with resolved review conversations. Its branch must be up to date and the required `build` check succeeds only after the Android package and the registration/restore integration job both pass. The portable ruleset also names `field-integration / register-and-restore` alongside `profiles`. Force pushes and deletion are blocked. The minimum approval count is zero while the repository has a single maintainer.

Inspect the effective policy and its settings with an authenticated account:

```sh
gh api repos/milank78git/angler-to-angler/rules/branches/main
gh api repos/milank78git/angler-to-angler/rulesets/27878561
```

The portable policy template lives in `.github/main-ruleset.json`. Keep the check names aligned with the workflow, select GitHub Actions as their expected source when restoring the ruleset, and increase the approval count once a second maintainer can review.

Private vulnerability reporting, the dependency graph, Dependabot alerts and security updates are enabled. Secret protection and push protection are active. PR jobs request read-only repository contents. Only publication and promotion on main receive write access. External actions are pinned to commit SHAs. Once merged, Dependabot's weekly configuration covers npm, Gradle and GitHub Actions. CODEOWNERS, issue forms, the pull request template and contribution and security policies live in the repository.

## Android distribution

Each successful push to main produces a pre-release after the Android and database checks pass. Download the APK directly from [Releases](https://github.com/milank78git/angler-to-angler/releases). The standard application ID and the certificate used for pilot 0.4.4 let Android install it over that pilot. A PR artifact signed with a runner's debug key has a different identity. Uninstalling it deletes its journal.

The installed version name comes from the manifest. The CI Android build number is 10000 plus the Android pilot workflow run number, so separate merges can share a version name and still upgrade in order. The tag, APK filename and version displayed inside the app identify the same build. A retry uses the same number. Preserve the workflow's run numbering when renaming or replacing it.

### Rotate the pilot signing identity

Keep an offline backup of the pilot 0.4.4 key. Rewrap it with strong passwords under a release alias.
Provision the rewrapped key with the existing `ANDROID_PILOT_KEYSTORE`, `ANDROID_PILOT_STORE_PASSWORD`,
`ANDROID_PILOT_KEY_PASSWORD` secrets and `ANDROID_PILOT_KEY_ALIAS` variable. Generate a separate PKCS12
pilot release key offline, outside the repository. Keep the Play signing key separate.

    keytool -genkeypair -storetype PKCS12 -keystore pilot-rotated.p12 -alias pilot-release -keyalg RSA -keysize 4096 -validity 10000
    apksigner rotate --out pilot.lineage --old-signer --ks pilot-original.p12 --new-signer --ks pilot-rotated.p12
    keytool -list -v -keystore pilot-rotated.p12 -alias pilot-release

Store the base64 PKCS12 and lineage as `ANDROID_ROTATED_KEYSTORE` and `ANDROID_PILOT_LINEAGE` secrets,
with `ANDROID_ROTATED_PASSWORD`. Set the public variables `ANDROID_ROTATED_ALIAS` and
`ANDROID_ROTATED_CERTIFICATE` (the new SHA-256 fingerprint). Deploy the generated assetlinks statement
to the verified App Links host before publishing. The release job checks both certs at the Android 9
rotation boundary. Android 8 continues to require the original signer for an in-place update.

Configure the public Actions variable `ANGLER_ACCOUNT_CONFIG` as described in [Accounts](accounts.md). The closed-pilot mail configuration still restricts who can sign in.

The **Android pilot** run summary links to the Preview APK ZIP as soon as it is uploaded. Extract the APK and install it beside the standard pilot. Published updates for existing pilot installations appear in Releases after signing.

To publish a fresh APK from the current main commit after configuring signing, select **Actions → Android pilot → Run workflow → main**, leave the tag empty and run the workflow. It builds a fresh APK with the configured atlas key, repeats the tests and publishes a pre-release. A failed release lists missing repository signing settings in its summary.

To promote an already tested APK, open **Actions → Android pilot → Run workflow**, select **main**, and enter the full published pilot tag. The workflow marks that release stable and latest using its existing tag and files. Verify a download by running `sha256sum -c angler-to-angler-<version>-build.<number>.apk.sha256` in the download directory.

### Atlas release signing

Generate a dedicated P-256 key offline and keep its backup under the atlas publisher's control.
Set the multiline PEM only as a secret named `ANGLER_ATLAS_SIGNING_KEY` in the protected `atlas-publication` environment. Set the matching
base64-encoded DER public key as the Actions variable `ANGLER_ATLAS_PUBLIC_KEY` used by
both Android builds and atlas publication.

```sh
umask 077
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out atlas-private.pem
openssl pkey -in atlas-private.pem -pubout -outform DER | openssl base64 -A
```

Configure the pair before merging the signed-atlas release, run **Publish the water directory**
and check a manual atlas update on the candidate APK. An absent signer stops publication.
An APK without a configured public key uses its bundled atlas. The client also drops trust in unsigned
editions cached by earlier versions. A failed update retains the last verified edition.
Coordinate key changes with an APK release because existing APKs pin their original signer.

### Automatic fishing rule editions

The daily water directory workflow also refreshes fishing rules. Its separate read-only job
fetches authoritative publications, matches supported articles and imports the effective
periods supplied by the Czech fishery register. It identifies its exact output by SHA-256.
The publisher validates the water artifact, checks the independent rules digest, combines the
two editions and signs the final manifest. The app receives updates on its usual atlas check.

See [Field guide maintenance](europe-field-guide.md#maintain-a-release) for source coverage
and exception handling. Each source follows its own effective dates.
