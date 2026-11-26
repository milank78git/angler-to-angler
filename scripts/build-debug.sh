#!/usr/bin/env bash
# Keep the existing artifact paths for instrumentation, upgrade tests and release signing.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  '') variant=pilot; task=assemblePilotRelease; out=build/standalone ;;
  --preview)
    variant=preview; task=assemblePreviewRelease; out=build/preview
    if [[ -n "${ANGLER_TEST_OUTPUT:-}" ]]; then out=build/smoke-app; fi ;;
  *) echo "Usage: bash scripts/build-debug.sh [--preview]" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
build_type=release
if [[ "${ANGLER_INTEGRATION_BUILD:-}" == true ]]; then
  build_type=debug
  task=${task%Release}Debug
fi
./gradlew ":app:$task"
mkdir -p "$out"
cp "app/build/outputs/apk/$variant/$build_type/app-$variant-$build_type.apk" "$out/angler-journal-debug.apk"
