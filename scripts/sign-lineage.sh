#!/usr/bin/env bash
# Android 9+ verifies the new signer and its embedded proof of rotation.
set -euo pipefail
signer=$1 rotated=$2 lineage=$3 old_pin=$4 new_pin=$5 input=$6 output=$7
new_pin=${new_pin//:/}
new_pin=${new_pin,,}
[[ $old_pin =~ ^[0-9a-f]{64}$ && $new_pin =~ ^[0-9a-f]{64}$ && $new_pin != "$old_pin" ]]
"$signer" sign --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true \
  --rotation-min-sdk-version 28 --lineage "$lineage" --out "$output" \
  --ks "$rotated" --ks-key-alias "$ANDROID_ROTATED_ALIAS" \
  --ks-pass env:ANDROID_ROTATED_PASSWORD --key-pass env:ANDROID_ROTATED_PASSWORD "$input"

history=$("$signer" lineage --in "$output" --print-certs --verbose)
mapfile -t pins < <(sed -n 's/^Signer #[0-9]* in lineage certificate SHA-256 digest: //p' <<< "$history")
[[ ${#pins[@]} == 2 && ${pins[0]} == "$old_pin" && ${pins[1]} == "$new_pin" ]]
# Inspect the original signer's block only. Missing or ambiguous flags fail closed.
if ! awk '
  /^Signer #[0-9]+ in lineage certificate DN:/ { original = ($2 == "#1") }
  original && /^Has installed data capability *: true$/ { transfer++ }
  original && /^Has rollback capability *: false$/ { no_rollback++ }
  END { exit !(transfer == 1 && no_rollback == 1) }
' <<< "$history"; then
  echo "The old signer must allow installed-data transfer and forbid rollback" >&2
  exit 1
fi
for api in 28 32 33 35; do
  certs=$("$signer" verify --min-sdk-version "$api" --max-sdk-version "$api" --print-certs "$output")
  [[ $(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$certs") == "$new_pin" ]]
done
"$signer" verify "$output"
