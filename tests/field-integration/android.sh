#!/usr/bin/env bash
set -euo pipefail
repo=$(pwd)
stage=${RUNNER_TEMP:?}/angler-integration
# Build both releases from isolated copies against the same disposable account service.
mkdir -p "$stage/client" "$stage/legacy"
git archive HEAD | tar -x -C "$stage/client"
git -C "$repo/legacy-journal" archive HEAD | tar -x -C "$stage/legacy"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext 'subjectAltName=DNS:localhost' -keyout "$stage/tls.key" -out "$stage/tls.crt" 2>/dev/null
for client in "$stage/client" "$stage/legacy"; do
  cd "$client"
  mkdir -p app/src/main/res/raw
  cp "$stage/tls.crt" app/src/main/res/raw/local_ca.pem
  cat > app/src/main/res/xml/local_trust.xml <<'XML'
<network-security-config><domain-config><domain>localhost</domain><trust-anchors><certificates src="@raw/local_ca"/></trust-anchors></domain-config></network-security-config>
XML
  sed -i 's/<application /<application android:debuggable="true" android:networkSecurityConfig="@xml\/local_trust" /' app/src/main/AndroidManifest.xml
done
cd "$stage/client"
export ANGLER_ACCOUNT_PAGES=true
python3 scripts/build-account-pages.py "$stage/account-pages" --preview
export ANGLER_ACCOUNT_CONFIG='{"url":"https://localhost:58443","publishableKey":"sb_publishable_loopback","deploymentNotices":{"cs":"Test","en":"Test"}}'
bash "$stage/legacy/scripts/build-debug.sh" >/dev/null
export ANGLER_INTEGRATION_BUILD=true
bash scripts/build-debug.sh --preview >/dev/null
bash scripts/build-debug.sh >/dev/null
python3 tests/field-integration/proxy.py "$stage" &
gateway=$!
trap 'kill "$gateway" 2>/dev/null || true' EXIT
adb reverse tcp:58443 tcp:58443
adb install -r build/preview/angler-journal-debug.apk
adb install -r "$stage/legacy/build/standalone/angler-journal-debug.apk"
adb shell wm size 1080x2200
adb shell wm density 320
python3 -m unittest discover -s tests/field-integration -p 'test_registration_ui.py'
python3 tests/field-integration/registration.py "$stage"
