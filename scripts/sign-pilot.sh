#!/usr/bin/env bash
# Re-sign the CI artifact with the original pilot identity and inspect the final APK.
set -euo pipefail
apk=${1:?Missing compiled APK}
bt=${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}
: "${ANDROID_PILOT_KEYSTORE:?Set the pilot keystore in GitHub Actions Secrets}"
key=$(mktemp)
trap 'rm -f "$key"' EXIT
printf '%s' "$ANDROID_PILOT_KEYSTORE" | base64 --decode > "$key"
unset ANDROID_PILOT_KEYSTORE

# The public certificate is pinned to the distributed 0.4.4 APK.
fingerprint=8194987893a64ee0abf250377c54a7d939b81743fa95020dd4a701ea45ad92b6
package=$("$bt/aapt" dump badging "$apk" | sed -n '1p')
pattern="^package: name='app\.anglers\.journal' versionCode='([0-9]+)' versionName='([0-9]+\.[0-9]+\.[0-9]+)'"
[[ $package =~ $pattern ]] || { echo "Expected the standard pilot package and a numeric version" >&2; exit 1; }
code=${BASH_REMATCH[1]}
version=${BASH_REMATCH[2]}
[[ $code == "$((10000 + GITHUB_RUN_NUMBER))" ]] || { echo "Unexpected APK build number" >&2; exit 1; }
unzip -p "$apk" assets/account-config.json | jq -e '.publishableKey | startswith("sb_publishable_")' >/dev/null

tag="v$version-build.$code"
out=build/release
name="angler-to-angler-${tag#v}.apk"
mkdir -p "$out"
# Existing pilot installations pin the certificate. The same private key can be
# rewrapped with strong passwords without rotating the certificate or losing journals.
case "${ANDROID_PILOT_STORE_PASSWORD:+s}${ANDROID_PILOT_KEY_PASSWORD:+k}" in
  sk) ;;
  '') export ANDROID_PILOT_STORE_PASSWORD=android ANDROID_PILOT_KEY_PASSWORD=android ;;
  *) echo "Set both pilot keystore passwords together" >&2; exit 1 ;;
esac
"$bt/apksigner" sign --ks "$key" --ks-key-alias "${ANDROID_PILOT_KEY_ALIAS:-androiddebugkey}" \
  --ks-pass env:ANDROID_PILOT_STORE_PASSWORD --key-pass env:ANDROID_PILOT_KEY_PASSWORD --out "$out/$name" "$apk"
unset ANDROID_PILOT_STORE_PASSWORD ANDROID_PILOT_KEY_PASSWORD
certs=$("$bt/apksigner" verify --print-certs "$out/$name")
[[ $(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$certs") == "$fingerprint" ]] || {
  echo "Signing certificate differs from pilot 0.4.4" >&2
  exit 1
}
(cd "$out" && sha256sum "$name" > "$name.sha256")
echo "tag=$tag" >> "${GITHUB_OUTPUT:?}"
