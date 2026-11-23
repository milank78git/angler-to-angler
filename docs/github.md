# Repository controls

The active [Protect main ruleset](https://github.com/milank78git/angler-to-angler/settings/rules/27878561) applies to the default branch. Changes require a pull request with resolved review conversations. Its branch must be up to date and both GitHub Actions jobs (`build` and `profiles`) must pass. Force pushes and deletion are blocked. The minimum approval count is zero while the repository has a single maintainer.

Inspect the effective policy and its settings with an authenticated account:

```sh
gh api repos/milank78git/angler-to-angler/rules/branches/main
gh api repos/milank78git/angler-to-angler/rulesets/27878561
```

The portable policy template lives in `.github/main-ruleset.json`. Keep the check names aligned with the workflow, select GitHub Actions as their expected source when restoring the ruleset, and increase the approval count once a second maintainer can review.

Private vulnerability reporting, the dependency graph, Dependabot alerts and security updates are enabled. Secret protection and push protection are active. The workflow requests read-only repository contents and pins external actions to commit SHAs. Once merged, Dependabot's weekly configuration covers npm, Gradle and GitHub Actions. CODEOWNERS, issue forms, the pull request template and contribution and security policies live in the repository.
