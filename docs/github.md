# Repository controls

The active [Protect main ruleset](https://github.com/milank78git/angler-to-angler/settings/rules/27878561) applies to the default branch. Changes require a pull request with resolved review conversations. Its branch must be up to date and both GitHub Actions jobs (`build` and `profiles`) must pass. Force pushes and deletion are blocked. The minimum approval count is zero while the repository has a single maintainer.

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

The release job re-signs the compiled standard APK with the base64-encoded 0.4.4 keystore in the Actions secret `ANDROID_PILOT_KEYSTORE`. It checks its certificate against that pilot, verifies that the packaged account configuration is present and attaches a SHA-256 file alongside the APK. Keep the original keystore backed up privately. Configure the public Actions variable `ANGLER_ACCOUNT_CONFIG` as described in [Accounts](accounts.md). The closed-pilot mail configuration still restricts who can sign in.

To promote an already tested APK, open **Actions → Android pilot → Run workflow**, select **main**, and enter the full published pilot tag. The workflow marks that release stable and latest using its existing tag and files. Verify a download by running `sha256sum -c angler-to-angler-<version>-build.<number>.apk.sha256` in the download directory.
