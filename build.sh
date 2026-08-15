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

# Update Chrome manifest — always set the version from current_version.json,
# regardless of whatever value the manifest currently holds. Using a wildcard
# pattern (instead of matching the old $VERSION exactly) guarantees the bump
# applies even if a manifest was previously edited out of sync.
inplace_sed "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" platforms/chrome/manifest.json
# Update Android manifest
inplace_sed "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" platforms/android/manifest.json
# Update Firefox manifest
inplace_sed "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" platforms/firefox/manifest.json
# Update iOS manifest
inplace_sed "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" platforms/ios/manifest.json

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

# Bundle the modular content script into a single file (MV3 content scripts
# can't use ES modules directly). Writes the bundled content.js into a target
# dir. Usage: bundle_content <target_dir>
bundle_content() {
  local target="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const SRC = process.argv[1];
    const OUT = process.argv[2];
    const seen = new Set();
    const parts = [];
    function strip(src){ return src.replace(/^import\s+[^;]+;\s*$/gm,"").replace(/^export\s+/gm,""); }
    function resolve(abs){
      if (seen.has(abs)) return;
      seen.add(abs);
      const src = fs.readFileSync(abs,"utf8");
      const re = /import\s*\{[^}]*\}\s*from\s*[\x27"]([^\x27"]+)[\x27"]\s*;/g;
      let m; const imports=[];
      while((m=re.exec(src))!==null) imports.push(m[1]);
      for (const spec of imports) resolve(path.resolve(path.dirname(abs), spec));
      parts.push(strip(src));
    }
    resolve(path.join(SRC,"content.js"));
    const body = parts.join("\n\n");
    // Wrap the ENTIRE bundle in an injection guard. Safari on iOS (and some
    // SPA navigations) re-injects content scripts, which would otherwise
    // redeclare top-level `let`/`const` from the inlined modules (e.g.
    // `annotationUrlWatcher`) and throw a SyntaxError. The `window` object
    // persists between these phantom re-injections, so the flag guarantees
    // the bundle body (and all its top-level declarations) runs only once.
    const out = "// AI Summary Helper — bundled content script (injection-guarded)\n" +
      "if (!window.__AISH_CONTENT_LOADED) {\n" +
      "    window.__AISH_CONTENT_LOADED = true;\n\n" +
      body + "\n\n}\n";
    fs.writeFileSync(path.join(OUT,"content.js"), out);
    console.log("  ✓ bundled content.js");
  ' "$ROOT_DIR/src" "$1"
}


# ==========================================
# 1. BUILD DESKTOP VERSION (Chrome)
# ==========================================
CHROME_DIR="$DEV_DIR/aish-extension-chrome"
rm -rf "$CHROME_DIR"
cp -r "$ROOT_DIR/src/" "$CHROME_DIR"
# Overwrite the default manifest with the Chrome one
cp -f "$ROOT_DIR/platforms/chrome/manifest.json" "$CHROME_DIR/manifest.json"
# The android manifest must not ship in the desktop build
rm -f "$CHROME_DIR/manifest-android.json"
# Bundle the modular content script
bundle_content "$CHROME_DIR"

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
cp -f "$ROOT_DIR/platforms/android/manifest.json" "$ANDROID_DIR/manifest.json"
rm -f "$ANDROID_DIR/manifest-android.json"
# Bundle the modular content script
bundle_content "$ANDROID_DIR"

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
# Bundle the modular content script
bundle_content "$FIREFOX_DIR"

FIREFOX_ZIP_FILE="$PROD_DIR/aish-extension-firefox-$NEW_VERSION.zip"
cd "$FIREFOX_DIR"
zip -r "$ROOT_DIR/$FIREFOX_ZIP_FILE" .
cd "$ROOT_DIR"

echo "✅ Firefox extension built: $FIREFOX_ZIP_FILE"

# ==========================================
# 4. BUILD IOS VERSION
# ==========================================
IOS_DIR="$DEV_DIR/aish-extension-ios"
rm -rf "$IOS_DIR"
cp -r "$ROOT_DIR/src/" "$IOS_DIR"

# Overwrite the default manifest with the iOS one
cp -f "$ROOT_DIR/platforms/ios/manifest.json" "$IOS_DIR/manifest.json"
# Clean up any leftover manifests
rm -f "$IOS_DIR/manifest-android.json"
# Bundle the modular content script
bundle_content "$IOS_DIR"

IOS_ZIP_FILE="$PROD_DIR/aish-extension-ios-$NEW_VERSION.zip"
cd "$IOS_DIR"
zip -r "$ROOT_DIR/$IOS_ZIP_FILE" .
cd "$ROOT_DIR"

echo "✅ iOS extension built: $IOS_ZIP_FILE"