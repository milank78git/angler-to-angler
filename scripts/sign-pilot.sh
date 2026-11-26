#!/usr/bin/env bash
# Re-sign the CI artifact with the rotated pilot identity and inspect the final APK.
set -euo pipefail
apk=${1:?Missing compiled APK}
bt=${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
: "${ANDROID_ROTATED_KEYSTORE:?Missing dedicated pilot release keystore}"
: "${ANDROID_ROTATED_PASSWORD:?Missing rotated PKCS12 password}"
: "${ANDROID_ROTATED_ALIAS:?Missing rotated alias}"
: "${ANDROID_ROTATED_CERTIFICATE:?Missing public release fingerprint}"
: "${ANDROID_PILOT_LINEAGE:?Missing offline signing lineage}"
[[ "$ANDROID_ROTATED_PASSWORD" != android && "${ANDROID_ROTATED_ALIAS,,}" != androiddebugkey ]]
printf '%s' "$ANDROID_ROTATED_KEYSTORE" | base64 --decode > "$work/rotated"
printf '%s' "$ANDROID_PILOT_LINEAGE" | base64 --decode > "$work/lineage"
unset ANDROID_ROTATED_KEYSTORE ANDROID_PILOT_LINEAGE
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
bash scripts/sign-lineage.sh "$bt/apksigner" "$work/rotated" "$work/lineage" \
  "$fingerprint" "$ANDROID_ROTATED_CERTIFICATE" "$apk" "$out/$name"
(cd "$out" && sha256sum "$name" > "$name.sha256")
echo "tag=$tag" >> "${GITHUB_OUTPUT:?}"
