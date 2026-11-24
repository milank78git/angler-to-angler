#!/usr/bin/env bash
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
# Trust an ephemeral test certificate only in an isolated copy of the preview application.
mkdir -p "$stage/client"
git archive HEAD | tar -x -C "$stage/client"
cd "$stage/client"
mkdir -p app/src/main/res/raw
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost' -keyout "$stage/tls.key" -out "$stage/tls.crt" 2>/dev/null
cp "$stage/tls.crt" app/src/main/res/raw/local_ca.pem
cat > app/src/main/res/xml/local_trust.xml <<'XML'
<network-security-config><domain-config><domain>localhost</domain><trust-anchors><certificates src="@raw/local_ca"/></trust-anchors></domain-config></network-security-config>
XML
sed -i 's/<application /<application android:networkSecurityConfig="@xml\/local_trust" /' app/src/main/AndroidManifest.xml
export ANGLER_APP_LINK_HOST=horistum.com
export ANGLER_ACCOUNT_CONFIG='{"url":"https://localhost:58443","publishableKey":"sb_publishable_loopback","deploymentNotices":{"cs":"Test","en":"Test"}}'
bash scripts/build-debug.sh --preview >/dev/null
python3 tests/field-integration/proxy.py "$stage" &
gateway=$!
trap 'kill "$gateway" 2>/dev/null || true' EXIT
adb reverse tcp:58443 tcp:58443
adb install -r build/preview/angler-journal-debug.apk
adb shell wm size 1080x2200
adb shell wm density 320
python3 tests/field-integration/registration.py "$stage"
