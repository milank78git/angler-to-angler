#!/usr/bin/env bash
# Check all required settings together. Only presence flags for secrets enter this step.
set -euo pipefail
missing=()
for name in ANGLER_ATLAS_PUBLIC_KEY ANDROID_ROTATED_CERTIFICATE ANDROID_ROTATED_ALIAS; do
  if [[ -z ${!name:-} ]]; then missing+=("Actions variable \`$name\`"); fi
done
check_secret() {
  if [[ $1 != true ]]; then missing+=("Actions secret \`$2\`"); fi
}
check_secret "${HAS_ROTATED_KEY:-false}" ANDROID_ROTATED_KEYSTORE
check_secret "${HAS_ROTATED_PASSWORD:-false}" ANDROID_ROTATED_PASSWORD
check_secret "${HAS_LINEAGE:-false}" ANDROID_PILOT_LINEAGE
if (( ${#missing[@]} )); then
  {
    echo '### Pilot publication requires these settings'
    echo
    printf -- '- %s\n' "${missing[@]}"
    echo
    echo 'Configure the existing pilot signing identity and publish the signed atlas as described in docs/github.md. When the atlas public key changes, start a new APK build so the application contains the matching key.'
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 1
fi
