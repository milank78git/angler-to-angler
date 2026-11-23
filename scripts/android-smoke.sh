#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
app_id=app.anglers.journal.preview
out=build/smoke
mkdir -p "$out"/{classes,dex}
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -Xlint:-options -bootclasspath "$bt/core-lambda-stubs.jar:$platform" -d "$out/classes" android-smoke/*.java
java -m jdk.jartool/sun.tools.jar.Main cf "$out/test.jar" -C "$out/classes" .
"$bt/d8" --lib "$platform" --min-api 26 --output "$out/dex" "$out/test.jar"
"$bt/aapt2" link -A android-smoke/assets -o "$out/test.apk" --manifest android-smoke/AndroidManifest.xml --rename-instrumentation-target-package "$app_id" -I "$platform"
zip -q -j "$out/test.apk" "$out/dex/classes.dex"
"$bt/zipalign" -f 4 "$out/test.apk" "$out/aligned.apk"
"$bt/apksigner" sign --ks "${ANDROID_DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}" --ks-pass pass:android --out "$out/test-signed.apk" "$out/aligned.apk"
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
adb install -r build/preview/angler-journal-debug.apk
adb install -r "$out/test-signed.apk"
mkdir -p "$out/screens"
for scenario in compact wide; do
  if [[ "$scenario" == compact ]]; then
    language=cs-CZ
    adb shell wm size 720x1440
    adb shell wm density 320
  else
    language=en-GB
    adb shell wm size 1620x1200
    adb shell wm density 260
  fi
  adb shell pm clear "$app_id"
  adb shell cmd locale set-app-locales "$app_id" --user 0 --locales "$language"
  adb shell cmd locale get-app-locales "$app_id" --user 0
  adb shell am instrument -w -e scenario "$scenario" app.anglers.journal.smoke/.Runner | tee "$out/$scenario.txt"
  adb pull "/sdcard/Android/data/$app_id/files/ui/." "$out/screens" || true
  grep -Fq ANGLER_SMOKE_PASS "$out/$scenario.txt"
done
