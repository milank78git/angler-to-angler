#!/usr/bin/env bash
# Exercise the production signer with disposable keys on the APK produced by the build.
set -euo pipefail
input=$(realpath "$1")
signer="${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}/apksigner"
script=$(realpath scripts/sign-lineage.sh)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
export ANDROID_PILOT_KEY_ALIAS=previous ANDROID_ROTATED_ALIAS=next
ANDROID_ROTATED_PASSWORD=$(openssl rand -hex 24)
export ANDROID_ROTATED_PASSWORD
export ANDROID_PILOT_STORE_PASSWORD="$ANDROID_ROTATED_PASSWORD" ANDROID_PILOT_KEY_PASSWORD="$ANDROID_ROTATED_PASSWORD"
for alias in previous next; do
  keytool -genkeypair -alias "$alias" -keystore "$alias.p12" -storetype PKCS12 \
    -storepass:env ANDROID_ROTATED_PASSWORD -dname "CN=Disposable $alias" -keyalg RSA -validity 2
done
"$signer" rotate --old-signer --ks previous.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD \
  --new-signer --ks next.p12 --ks-pass env:ANDROID_ROTATED_PASSWORD --out pilot.lineage
fingerprint() {
  keytool -exportcert -alias "$1" -keystore "$1.p12" -storepass:env ANDROID_ROTATED_PASSWORD | sha256sum | cut -d' ' -f1
}
bash "$script" "$signer" previous.p12 next.p12 pilot.lineage "$(fingerprint previous)" "$(fingerprint next)" "$input" release.apk
if bash "$script" "$signer" previous.p12 next.p12 pilot.lineage "$(fingerprint previous)" "$(fingerprint previous)" "$input" wrong.apk; then
  echo "An unchanged signing certificate was accepted" >&2
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
fi
