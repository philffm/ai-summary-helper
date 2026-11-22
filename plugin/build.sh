#!/bin/bash

set -euo pipefail

# Build the extension for all platforms
#   - dev/  : unpacked build directories (for loading unpacked in a browser)
#   - prod/ : zipped release artifacts
#
# This script lives in plugin/ and is self-locating: every path below is
# resolved relative to this file's directory, so it works no matter where
# you invoke it from. The two inputs that live outside plugin/ (the
# compatible-tools table in the root readme.md and the version source of
# truth at the repo root) are reached via ../.

# Resolve this script's own directory (handles symlinks too).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Arguments ──────────────────────────────────────────────────────────
#   --version <x.y.z>   build THIS version (stamped into the manifests, current_version.json and popup.html) instead of the next patch
# Everything else (platform names, --kaivo, --brand=<id>, --strict, ...) goes to scripts/build.js.
TARGET_VERSION=""
BUILD_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)   [ "$#" -ge 2 ] || { echo "✗ --version needs a value, e.g. --version 2.3.0" >&2; exit 1; }; TARGET_VERSION="$2"; shift 2 ;;
    --version=*) TARGET_VERSION="${1#--version=}"; shift ;;
    *)           BUILD_ARGS+=("$1"); shift ;;
  esac
done
if [ -n "$TARGET_VERSION" ] && ! [[ "$TARGET_VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
  echo "✗ --version must look like 2.3.0 (digits and dots) (got '$TARGET_VERSION')" >&2; exit 1
fi

# ── Compatible tools table ────────────────────────────────────────────
# The table lives in the root readme.md (the marketing/overview readme).
# Regenerate compatible-tools.json from it, then copy into src/.
awk '/Name \| Description \| URL/{flag=1; next} /--- \| --- \| ---/{next} /^$/{flag=0} flag' ../readme.md > table.txt

awk 'BEGIN{ FS="|"; print "[" }
{
  sub(/^[ \t]+/, "", $1); sub(/[ \t]+$/, "", $1);
  sub(/^[ \t]+/, "", $2); sub(/[ \t]+$/, "", $2);
  sub(/^[ \t]+/, "", $3); sub(/[ \t]+$/, "", $3);
  names[NR]=$1; descriptions[NR]=$2; urls[NR]=$3;
}
END{
  for(i=1;i<=NR;i++){
    printf "  {\n    \"Name\": \"%s\",\n    \"Description\": \"%s\",\n    \"URL\": \"%s\"\n  }", names[i], descriptions[i], urls[i];
    if(i<NR) { print "," } else { print "" }
    print ""
  }
  print "]"
}' table.txt > compatible-tools.json

cp -f compatible-tools.json src/

# Read the base version from current_version.json as the single source of truth
VERSION=$(jq -r '.version' ../current_version.json)
if [ -n "$TARGET_VERSION" ]; then
  # An explicit target version: set exactly that (also lower than the current one, e.g. to redo a release).
  NEW_VERSION="$TARGET_VERSION"
  "$SCRIPT_DIR/scripts/set-version.sh" "$NEW_VERSION"
elif [ -n "${KEEP_VERSION:-}" ]; then
  # Rebuild the current version (e.g. after a packaging fix): no bump, nothing stamped, the manifests already carry it.
  NEW_VERSION="$VERSION"
else
  NEW_VERSION=$(echo "$VERSION" | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')

  # Stamp it into the platform manifests, current_version.json and popup.html.
  "$SCRIPT_DIR/scripts/set-version.sh" "$NEW_VERSION"
fi


# ==========================================
# Output directories
# ==========================================
ROOT_DIR="$SCRIPT_DIR"
DEV_DIR="dev"
PROD_DIR="prod"
rm -rf "$DEV_DIR" "$PROD_DIR"
mkdir -p "$DEV_DIR" "$PROD_DIR"

# ==========================================
# Build every platform with the one build implementation (scripts/build.js), then zip
# ==========================================
# scripts/build.js does the whole job: design-token gate (WCAG AA, up to date), the platform copies and manifests, the bundled
# content script and workers, slimmed _locales, and the AISH colours for the plain build. Arguments go straight to it, so
#   ./build.sh                 the AISH build, 4 platforms
#   ./build.sh --kaivo         plus the Kaivo build (dev/kaivo-extension-<platform>); needs the local brands/ folder
#   ./build.sh --brand=<id>    any other brand;  ./build.sh chrome  only one platform;  ./build.sh --kaivo --strict
#   ./build.sh --version 2.3.0 build and stamp exactly that version (default: the next patch; KEEP_VERSION=1 keeps the current one)
# Every dev/<brand>-extension-<platform> then becomes prod/<brand>-extension-<platform>-<version>.zip.
node scripts/build.js ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}

shopt -s nullglob
ZIPS=0
for dir in "$DEV_DIR"/*-extension-*; do
  name="$(basename "$dir")"
  zip_file="$PROD_DIR/$name-$NEW_VERSION.zip"
  (cd "$dir" && zip -qr "$ROOT_DIR/$zip_file" . -x "*.DS_Store")
  echo "✅ $name built: $zip_file"
  ZIPS=$((ZIPS + 1))
done
if [ "$ZIPS" -eq 0 ]; then
  echo "✗ nothing was built (check the platform name in the arguments)" >&2
  exit 1
fi
