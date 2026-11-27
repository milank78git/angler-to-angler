#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
app_id=app.anglers.journal.preview
out=build/smoke
mkdir -p "$out"/{classes,dex,test-assets}
cp -R android-smoke/assets/. "$out/test-assets/"
# This ephemeral private key is packaged only in the separate instrumentation APK.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$out/atlas-test.pem"
openssl pkcs8 -topk8 -nocrypt -in "$out/atlas-test.pem" -outform DER -out "$out/test-assets/atlas-test.pk8"
export ANGLER_ATLAS_PUBLIC_KEY=$(openssl pkey -in "$out/atlas-test.pem" -pubout -outform DER | base64 -w0)
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -Xlint:-options -bootclasspath "$bt/core-lambda-stubs.jar:$platform" -d "$out/classes" android-smoke/*.java
java -m jdk.jartool/sun.tools.jar.Main cf "$out/test.jar" -C "$out/classes" .
"$bt/d8" --lib "$platform" --min-api 28 --output "$out/dex" "$out/test.jar"
"$bt/aapt2" link -A "$out/test-assets" -o "$out/test.apk" --manifest android-smoke/AndroidManifest.xml --rename-instrumentation-target-package "$app_id" -I "$platform"
zip -q -j "$out/test.apk" "$out/dex/classes.dex"
"$bt/zipalign" -f 4 "$out/test.apk" "$out/aligned.apk"
development_key=$(./gradlew --quiet :app:printDebugKeystore)
"$bt/apksigner" sign --ks "$development_key" --ks-pass pass:android --out "$out/test-signed.apk" "$out/aligned.apk"
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
ANGLER_ACCOUNT_CONFIG_FILE=android-smoke/account-config.json ANGLER_TEST_OUTPUT=1 bash scripts/build-debug.sh --preview
adb install -r build/smoke-app/angler-journal-debug.apk
adb install -r "$out/test-signed.apk"
mkdir -p "$out/screens"
# The optional system-lock test runs on the disposable CI emulator only.
secure_emulator=false
if [[ "${CI:-}" == true && "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]]; then
  secure_emulator=true
fi
for scenario in compact wide; do
  if [[ "$scenario" == compact ]]; then
    language=cs-CZ
    adb shell wm size 720x1440
    adb shell wm density 320
  else
    if $secure_emulator; then
      adb shell locksettings set-pin 482619 | grep -F 'set to'
      trap 'adb shell locksettings clear --old 482619 >/dev/null' EXIT
    fi
    language=en-GB
    adb shell wm size 1620x1200
    adb shell wm density 260
  fi
  adb shell pm clear "$app_id"
  adb shell cmd locale set-app-locales "$app_id" --user 0 --locales "$language"
  adb shell cmd locale get-app-locales "$app_id" --user 0
  if ! timeout 6m adb shell am instrument -w -e scenario "$scenario" app.anglers.journal.smoke/.Runner | tee "$out/$scenario.txt"; then
    adb shell dumpsys activity activities | grep -m 3 -E 'mResumedActivity|topResumedActivity' || true
    adb logcat -d -t 500 AndroidRuntime:E ActivityTaskManager:I Instrumentation:I '*:S' | tail -80 || true
    exit 1
  fi
  adb pull "/sdcard/Android/data/$app_id/files/ui/." "$out/screens" || true
  grep -Fq ANGLER_SMOKE_PASS "$out/$scenario.txt"
done

# Exercise notifications after the ordinary scenarios, which start with fresh permissions.
if (( $(adb shell getprop ro.build.version.sdk | tr -d '\r') >= 33 )); then
  adb shell pm grant "$app_id" android.permission.POST_NOTIFICATIONS
fi
adb shell am instrument -w -e scenario season app.anglers.journal.smoke/.Runner | tee "$out/season.txt"
grep -Fq ANGLER_SEASON_PASS "$out/season.txt"

if $secure_emulator; then
  adb shell am force-stop "$app_id"
  adb shell am instrument -w -e scenario unlock app.anglers.journal.smoke/.Runner | tee "$out/unlock.txt"
  grep -Fq ANGLER_UNLOCK_PASS "$out/unlock.txt"
fi
