#!/usr/bin/env bash
# Authorize a known successor of the distributed pilot key without exporting either private key.
set -euo pipefail
umask 077
old_pin=${1:?Missing original pilot certificate fingerprint}
output=${2:?Missing destination for the public proof}
signer="${ANDROID_BUILD_TOOLS:-${ANDROID_HOME:?}/build-tools/35.0.0}/apksigner"
: "${ANDROID_PILOT_KEYSTORE:?Missing original pilot keystore}"
: "${ANDROID_ROTATED_KEYSTORE:?Missing rotated keystore}"
: "${ANDROID_ROTATED_PASSWORD:?Missing rotated keystore password}"
: "${ANDROID_ROTATED_ALIAS:?Missing rotated alias}"
: "${ANDROID_ROTATED_CERTIFICATE:?Missing rotated certificate fingerprint}"
new_pin=${ANDROID_ROTATED_CERTIFICATE//:/}
new_pin=${new_pin,,}

if [[ ! $old_pin =~ ^[0-9a-f]{64}$ || ! $new_pin =~ ^[0-9a-f]{64}$ || $old_pin == "$new_pin" ]]; then
  echo 'Expected two distinct SHA-256 certificate fingerprints.' >&2
  exit 1
fi
if [[ $ANDROID_ROTATED_PASSWORD == android || ${ANDROID_ROTATED_ALIAS,,} == androiddebugkey ]]; then
  echo 'The release signer requires a dedicated alias and password.' >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s' "$ANDROID_PILOT_KEYSTORE" | base64 --decode > "$work/original"
printf '%s' "$ANDROID_ROTATED_KEYSTORE" | base64 --decode > "$work/rotated"
unset ANDROID_PILOT_KEYSTORE ANDROID_ROTATED_KEYSTORE

# The historical pilot was distributed using the standard debug alias and password.
# Compare the DER certificate at each alias before granting the new signer any capability.
fingerprint() {
  keytool -exportcert "$@" | sha256sum | cut -d' ' -f1
}
actual_old=$(fingerprint -keystore "$work/original" -alias androiddebugkey -storepass android)
actual_new=$(fingerprint -keystore "$work/rotated" -alias "$ANDROID_ROTATED_ALIAS" -storepass:env ANDROID_ROTATED_PASSWORD)
if [[ $actual_old != "$old_pin" ]]; then
  echo 'The original keystore does not match the published pilot certificate.' >&2
  exit 1
fi
if [[ $actual_new != "$new_pin" ]]; then
  echo 'The rotated keystore does not match ANDROID_ROTATED_CERTIFICATE.' >&2
  exit 1
fi

"$signer" rotate --out "$work/pilot.lineage" \
  --old-signer --ks "$work/original" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --set-installed-data true --set-rollback false \
  --new-signer --ks "$work/rotated" --ks-key-alias "$ANDROID_ROTATED_ALIAS" \
  --ks-pass env:ANDROID_ROTATED_PASSWORD --key-pass env:ANDROID_ROTATED_PASSWORD
"$signer" lineage --in "$work/pilot.lineage" --print-certs --verbose
install -m 600 "$work/pilot.lineage" "$output"
