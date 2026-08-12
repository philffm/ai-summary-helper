#!/bin/bash

set -euo pipefail

# Build the extension for all platforms
#   - dev/  : unpacked build directories (for loading unpacked in a browser)
#   - prod/ : zipped release artifacts

# copy files from assets to src
cp -f translations.json src/

# Read the table from the Compatible Tools section of readme.md (Root)
awk '/Name \| Description \| URL/{flag=1; next} /--- \| --- \| ---/{next} /^$/{flag=0} flag' readme.md > table.txt

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
VERSION=$(jq -r '.version' current_version.json)
NEW_VERSION=$(echo "$VERSION" | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')

# Portable in-place sed helper for macOS (BSD sed) and Linux (GNU sed)
inplace_sed() {
  local expr="$1"
  local file="$2"
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "$expr" "$file"
  else
    sed -i "$expr" "$file"
  fi
}

# Update Desktop manifest
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" src/manifest.json
# Update Android manifest
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" src/manifest-android.json
# Update Firefox manifest
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" platforms/firefox/manifest.json
# Update iOS manifest
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" platforms/ios/manifest.json

# Update current_version.json
jq ".version = \"$NEW_VERSION\"" current_version.json > current_version.json.tmp && mv current_version.json.tmp current_version.json

# inject version into popup.html
inplace_sed "s|<span id=\"versionNumber\">[^<]*</span>|<span id=\"versionNumber\">$NEW_VERSION</span>|" src/popup.html


# ==========================================
# Output directories
# ==========================================
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="dev"
PROD_DIR="prod"
rm -rf "$DEV_DIR" "$PROD_DIR"
mkdir -p "$DEV_DIR" "$PROD_DIR"


# ==========================================
# 1. BUILD DESKTOP VERSION (Chrome)
# ==========================================
CHROME_DIR="$DEV_DIR/aish-extension-chrome"
rm -rf "$CHROME_DIR"
cp -r "$ROOT_DIR/src/" "$CHROME_DIR"
# The android manifest must not ship in the desktop build
rm -f "$CHROME_DIR/manifest-android.json"

CHROME_ZIP_FILE="$PROD_DIR/aish-extension-chrome-$NEW_VERSION.zip"
cd "$CHROME_DIR"
zip -r "$ROOT_DIR/$CHROME_ZIP_FILE" .
cd "$ROOT_DIR"

echo "✅ Chrome extension built: $CHROME_ZIP_FILE"


# ==========================================
# 2. BUILD ANDROID VERSION
# ==========================================
ANDROID_DIR="$DEV_DIR/aish-extension-android"
rm -rf "$ANDROID_DIR"
cp -r "$ROOT_DIR/src/" "$ANDROID_DIR"

# Overwrite the default manifest with the Android one
mv "$ANDROID_DIR/manifest-android.json" "$ANDROID_DIR/manifest.json"

ANDROID_ZIP_FILE="$PROD_DIR/aish-extension-android-$NEW_VERSION.zip"
cd "$ANDROID_DIR"
zip -r "$ROOT_DIR/$ANDROID_ZIP_FILE" .
cd "$ROOT_DIR"

echo "✅ Android extension built: $ANDROID_ZIP_FILE"


# ==========================================
# 3. BUILD FIREFOX VERSION
# ==========================================
FIREFOX_DIR="$DEV_DIR/aish-extension-firefox"
rm -rf "$FIREFOX_DIR"
cp -r "$ROOT_DIR/src/" "$FIREFOX_DIR"
cp -f "$ROOT_DIR/platforms/firefox/manifest.json" "$FIREFOX_DIR/manifest.json"
rm -f "$FIREFOX_DIR/manifest-android.json"

FIREFOX_ZIP_FILE="$PROD_DIR/aish-extension-firefox-$NEW_VERSION.zip"
cd "$FIREFOX_DIR"
zip -r "$ROOT_DIR/$FIREFOX_ZIP_FILE" .
cd "$ROOT_DIR"

echo "✅ Firefox extension built: $FIREFOX_ZIP_FILE"