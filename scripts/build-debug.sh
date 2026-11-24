#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
platform="${ANDROID_PLATFORM_JAR:-$sdk/platforms/android-35/android.jar}"
bt="${ANDROID_BUILD_TOOLS:-$sdk/build-tools/35.0.0}"
out=build/standalone
link_args=()
app_id=app.anglers.journal
if [[ "${1:-}" == "--preview" ]]; then
  out=build/preview
  app_id=app.anglers.journal.preview
  link_args=(--rename-manifest-package "$app_id")
elif [[ $# != 0 ]]; then
  echo "Usage: bash scripts/build-debug.sh [--preview]" >&2
  exit 2
fi
# Distributed builds expose the workflow build number through Android's package metadata.
if [[ -n "${ANGLER_VERSION_CODE:-}" ]]; then
  [[ "$ANGLER_VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]] && (( ANGLER_VERSION_CODE <= 2100000000 )) || {
    echo "Invalid Android version code" >&2
    exit 2
  }
  link_args+=(--replace-version --version-code "$ANGLER_VERSION_CODE")
fi
if [[ -n "${ANGLER_TEST_OUTPUT:-}" && "${1:-}" == "--preview" ]]; then out=build/smoke-app; fi
rm -rf "$out"
mkdir -p "$out"/{gen,classes,dex}
cp -R app/src/main/assets "$out/assets"
python3 scripts/account-config.py "$out/assets/account-config.json"
host=$(python3 scripts/app-link-host.py)
mkdir -p "$out/res/values"
cp -R app/src/main/res/. "$out/res/"
use_web=false
if [[ -n "${ANGLER_APP_LINK_HOST:-}" ]]; then use_web=true; fi
printf '<resources><bool name="use_verified_links">%s</bool><string name="app_link_host" translatable="false">%s</string></resources>\n' "$use_web" "$host" > "$out/res/values/app_links.xml"
manifest="$out/AndroidManifest.xml"
label=app_name
if [[ "${1:-}" == "--preview" ]]; then label=app_name_preview; fi
sed -e 's/${appLinkHost}/'"$host"'/g' -e 's/${applicationId}/'"$app_id"'/g' -e "s|@string/app_name\"|@string/$label\"|g" app/src/main/AndroidManifest.xml > "$manifest"
"$bt/aapt2" compile --dir "$out/res" -o "$out/resources.zip"
"$bt/aapt2" link -o "$out/resources.apk" --manifest "$manifest" "${link_args[@]}" -I "$platform" --java "$out/gen" -A "$out/assets" "$out/resources.zip"
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
