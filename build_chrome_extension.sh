#!/bin/bash

set -euo pipefail

# Build the chrome extension

# copy files from assets to chrome-extension
cp -f translations.json chrome-extension/

# Read the table from the Compatible Tools section of readme.md (Root)
awk '/Name \| Description \| URL/{flag=1; next} /--- \| --- \| ---/{next} /^$/{flag=0} flag' readme.md > table.txt

# --- FIX IS HERE: Split the left and right whitespace trimming into separate commands ---
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
# -----------------------------------------------------------------------------------------

cp -f compatible-tools.json chrome-extension/

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
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" chrome-extension/manifest.json
# Update Android manifest
inplace_sed "s/\"version\": \"$VERSION\"/\"version\": \"$NEW_VERSION\"/" chrome-extension/manifest-android.json

# Update current_version.json
jq ".version = \"$NEW_VERSION\"" current_version.json > current_version.json.tmp && mv current_version.json.tmp current_version.json

# inject version into popup.html
inplace_sed "s|<span id=\"versionNumber\">[^<]*</span>|<span id=\"versionNumber\">$NEW_VERSION</span>|" chrome-extension/popup.html


# ==========================================
# 1. BUILD DESKTOP VERSION
# ==========================================
ZIP_FILE="chrome-extension-$NEW_VERSION.zip"
[ -f "$ZIP_FILE" ] && rm "$ZIP_FILE"

# Temporarily hide the android manifest so it doesn't end up in the desktop zip
mv chrome-extension/manifest-android.json ./manifest-android.tmp

zip -r "$ZIP_FILE" chrome-extension/
echo "✅ Desktop extension built: $ZIP_FILE"


# ==========================================
# 2. BUILD ANDROID VERSION
# ==========================================
# Bring the android manifest back
mv ./manifest-android.tmp chrome-extension/manifest-android.json

ANDROID_DIR="chrome-extension-android"

# Create a clean temporary directory for the Android build
rm -rf "$ANDROID_DIR"
cp -r chrome-extension/ "$ANDROID_DIR"

# Overwrite the default manifest with the Android one, and clean up
mv "$ANDROID_DIR/manifest-android.json" "$ANDROID_DIR/manifest.json"

ANDROID_ZIP_FILE="chrome-extension-android-$NEW_VERSION.zip"
[ -f "$ANDROID_ZIP_FILE" ] && rm "$ANDROID_ZIP_FILE"
zip -r "$ANDROID_ZIP_FILE" "$ANDROID_DIR"/

echo "✅ Android extension built: $ANDROID_ZIP_FILE"

# Clean up the temporary android build folder
rm -rf "$ANDROID_DIR"