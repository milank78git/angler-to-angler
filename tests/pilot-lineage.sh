#!/usr/bin/env bash
# Exercise the production signer with disposable keys on the APK produced by the build.
set -euo pipefail
input=$(realpath "$1")
signer="${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}/apksigner"
script=$(realpath scripts/sign-lineage.sh)
prepare=$(realpath scripts/prepare-pilot-lineage.sh)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
export ANDROID_ROTATED_ALIAS=next
ANDROID_ROTATED_PASSWORD=$(openssl rand -hex 24)
export ANDROID_ROTATED_PASSWORD
keytool -genkeypair -alias androiddebugkey -keystore previous.jks -storetype JKS \
  -storepass android -keypass android -dname "CN=Disposable previous" -keyalg RSA -validity 2
keytool -genkeypair -alias next -keystore next.p12 -storetype PKCS12 \
  -storepass:env ANDROID_ROTATED_PASSWORD -dname "CN=Disposable next" -keyalg RSA -validity 2
old_pin=$(keytool -exportcert -keystore previous.jks -alias androiddebugkey -storepass android | sha256sum | cut -d' ' -f1)
new_pin=$(keytool -exportcert -keystore next.p12 -alias next -storepass:env ANDROID_ROTATED_PASSWORD | sha256sum | cut -d' ' -f1)
prepare_lineage() {
  ANDROID_PILOT_KEYSTORE=$(base64 -w0 previous.jks) ANDROID_ROTATED_KEYSTORE=$(base64 -w0 next.p12) \
    ANDROID_ROTATED_CERTIFICATE="$2" bash "$prepare" "$1" "$3"
}
# Exercise both pin checks before authorizing the actual successor.
wrong_pin=$(printf '%064d' 0)
if prepare_lineage "$wrong_pin" "$new_pin" wrong-old.lineage || prepare_lineage "$old_pin" "$wrong_pin" wrong-new.lineage; then
  echo "A mismatched signer was accepted" >&2
  exit 1
fi
[[ ! -e wrong-old.lineage && ! -e wrong-new.lineage ]]
prepare_lineage "$old_pin" "$new_pin" pilot.lineage
bash "$script" "$signer" next.p12 pilot.lineage "$old_pin" "$new_pin" "$input" release.apk
if bash "$script" "$signer" next.p12 pilot.lineage "$old_pin" "$old_pin" "$input" wrong.apk; then
  echo "An unchanged signing certificate was accepted" >&2
  exit 1
fi
# An otherwise valid lineage must fail if the old key can sign another update.
"$signer" lineage --in pilot.lineage --signer --ks previous.jks --ks-pass pass:android \
  --set-rollback true --out rollback.lineage
if bash "$script" "$signer" next.p12 rollback.lineage "$old_pin" "$new_pin" "$input" rollback.apk; then
  echo "Legacy rollback capability was accepted" >&2
  exit 1
fi
if [[ "${2:-}" == "--install-on-emulator" ]]; then
  [[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]]
  "$signer" sign --ks previous.jks --ks-pass pass:android --out previous.apk "$input"
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
