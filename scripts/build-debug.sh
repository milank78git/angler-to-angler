#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
out=build/standalone
rm -rf "$out"
mkdir -p "$out"/{gen,classes,dex}
"$bt/aapt2" compile --dir app/src/main/res -o "$out/resources.zip"
"$bt/aapt2" link -o "$out/resources.apk" --manifest app/src/main/AndroidManifest.xml -I "$platform" --java "$out/gen" -A app/src/main/assets "$out/resources.zip"
find app/src/main/java "$out/gen" -name '*.java' | sort > "$out/sources"
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -bootclasspath "$bt/core-lambda-stubs.jar:$platform" -Xlint:-options -d "$out/classes" @"$out/sources"
java -m jdk.jartool/sun.tools.jar.Main cf "$out/classes.jar" -C "$out/classes" .
"$bt/d8" --lib "$platform" --min-api 26 --output "$out/dex" "$out/classes.jar"
cp "$out/resources.apk" "$out/unsigned.apk"
zip -q -j "$out/unsigned.apk" "$out/dex/classes.dex"
"$bt/zipalign" -f 4 "$out/unsigned.apk" "$out/aligned.apk"
key="${ANDROID_DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"
if [[ ! -f "$key" ]]; then
  mkdir -p "$(dirname "$key")"
  keytool -genkeypair -keystore "$key" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US' >/dev/null
fi
"$bt/apksigner" sign --ks "$key" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$out/angler-journal-debug.apk" "$out/aligned.apk"
"$bt/apksigner" verify --verbose "$out/angler-journal-debug.apk"
