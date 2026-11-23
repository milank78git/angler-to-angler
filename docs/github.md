# Repository controls

CODEOWNERS requests review from the current owner. The CI workflow uses read-only permissions and commit-pinned actions. Dependabot checks npm, Gradle and GitHub Actions weekly. The contribution guide, issue forms, security contact, third-party notices and PR template live in the repository.

To apply the live default branch rules, import `.github/main-ruleset.json` in Settings → Rules → Rulesets, or use the authenticated owner CLI below. Inspect existing rules first and update the named ruleset if already present. Keep both workflow job names in sync with CI. The policy requires a PR, resolved conversations, passing Android and profile database checks, and blocks force pushes and deletion. The approval count is zero for a solo maintainer; increase it when a second reviewer can approve.

```sh
gh api repos/milank78git/angler-to-angler/rulesets
gh api --method POST repos/milank78git/angler-to-angler/rulesets --input .github/main-ruleset.json
gh api repos/milank78git/angler-to-angler/rules/branches/main
```

Enable Dependabot alerts and private vulnerability reporting in repository settings. GitHub enables version updates after the configuration reaches the default branch. Check permitted Actions, read-only default workflow permissions and secret scanning/push protection in the repository security settings. Keep administrator credentials outside Actions workflows.
