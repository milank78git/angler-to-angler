#!/usr/bin/env bash
# Verify the signing identity selected by Android on both sides of the v3 rotation boundary.
set -euo pipefail
signer=$1 original=$2 rotated=$3 lineage=$4 old_pin=$5 new_pin=$6 input=$7 output=$8
new_pin=${new_pin//:/}
new_pin=${new_pin,,}
[[ $old_pin =~ ^[0-9a-f]{64}$ && $new_pin =~ ^[0-9a-f]{64}$ && $new_pin != "$old_pin" ]]
"$signer" sign --rotation-min-sdk-version 28 --lineage "$lineage" --out "$output" \
  --ks "$original" --ks-key-alias "$ANDROID_PILOT_KEY_ALIAS" \
  --ks-pass env:ANDROID_PILOT_STORE_PASSWORD --key-pass env:ANDROID_PILOT_KEY_PASSWORD \
  --next-signer --ks "$rotated" --ks-key-alias "$ANDROID_ROTATED_ALIAS" \
  --ks-pass env:ANDROID_ROTATED_PASSWORD --key-pass env:ANDROID_ROTATED_PASSWORD "$input"
verify() {
  local min=$1 max=$2 expected=$3 certs
  certs=$("$signer" verify --min-sdk-version "$min" --max-sdk-version "$max" --print-certs "$output")
  [[ $(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$certs") == "$expected" ]]
}
verify 26 27 "$old_pin"
verify 28 32 "$new_pin"
verify 33 35 "$new_pin"
"$signer" verify "$output"
