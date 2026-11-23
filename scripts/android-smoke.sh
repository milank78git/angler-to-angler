#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
out=build/smoke
mkdir -p "$out"/{classes,dex}
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -Xlint:-options -bootclasspath "$bt/core-lambda-stubs.jar:$platform" -d "$out/classes" android-smoke/Runner.java
java -m jdk.jartool/sun.tools.jar.Main cf "$out/test.jar" -C "$out/classes" .
"$bt/d8" --lib "$platform" --min-api 26 --output "$out/dex" "$out/test.jar"
"$bt/aapt2" link -o "$out/test.apk" --manifest android-smoke/AndroidManifest.xml -I "$platform"
zip -q -j "$out/test.apk" "$out/dex/classes.dex"
"$bt/zipalign" -f 4 "$out/test.apk" "$out/aligned.apk"
"$bt/apksigner" sign --ks "${ANDROID_DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}" --ks-pass pass:android --out "$out/test-signed.apk" "$out/aligned.apk"
if [[ "${1:-}" == "--build-only" ]]; then exit 0; fi
adb install -r build/standalone/angler-journal-debug.apk
adb install -r "$out/test-signed.apk"
adb shell pm clear app.anglers.journal
adb shell am instrument -w app.anglers.journal.smoke/.Runner | tee "$out/result.txt"
rg -q ANGLER_SMOKE_PASS "$out/result.txt"
