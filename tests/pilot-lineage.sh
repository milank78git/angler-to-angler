#!/usr/bin/env bash
# Exercise the production signer with disposable keys on the APK produced by the build.
set -euo pipefail
input=$(realpath "$1")
signer="${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}/apksigner"
script=$(realpath scripts/sign-lineage.sh)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
export ANDROID_ROTATED_ALIAS=next
ANDROID_ROTATED_PASSWORD=$(openssl rand -hex 24)
export ANDROID_ROTATED_PASSWORD
for alias in previous next; do
  keytool -genkeypair -alias "$alias" -keystore "$alias.p12" -storetype PKCS12 \
    -storepass:env ANDROID_ROTATED_PASSWORD -dname "CN=Disposable $alias" -keyalg RSA -validity 2
done
"$signer" rotate --old-signer --ks previous.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD \
  --set-installed-data true --set-rollback false --new-signer --ks next.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD --out pilot.lineage
fingerprint() {
  keytool -exportcert -alias "$1" -keystore "$1.p12" -storepass:env ANDROID_ROTATED_PASSWORD | sha256sum | cut -d' ' -f1
}
bash "$script" "$signer" next.p12 pilot.lineage "$(fingerprint previous)" "$(fingerprint next)" "$input" release.apk
if bash "$script" "$signer" next.p12 pilot.lineage "$(fingerprint previous)" "$(fingerprint previous)" "$input" wrong.apk; then
  echo "An unchanged signing certificate was accepted" >&2
  exit 1
fi
# An otherwise valid lineage must fail if the old key can sign another update.
"$signer" lineage --in pilot.lineage --signer --ks previous.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD \
  --set-rollback true --out rollback.lineage
if bash "$script" "$signer" next.p12 rollback.lineage "$(fingerprint previous)" "$(fingerprint next)" "$input" rollback.apk; then
  echo "Legacy rollback capability was accepted" >&2
  exit 1
fi
if [[ "${2:-}" == "--install-on-emulator" ]]; then
  [[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]]
  "$signer" sign --ks previous.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD --out previous.apk "$input"
  adb install previous.apk
  package=app.anglers.journal
  before=$(adb shell pm list packages -U "$package" | tr -d '\r')
  [[ "$before" == *"package:$package uid:"* ]]
  adb install -r release.apk
  [[ "$(adb shell pm list packages -U "$package" | tr -d '\r')" == "$before" ]]
  if result=$(adb install -r previous.apk 2>&1) || [[ $result != *INSTALL_FAILED_UPDATE_INCOMPATIBLE* ]]; then
    echo "Expected Android to reject a subsequent update signed with the old key: $result" >&2
    exit 1
  fi
fi
