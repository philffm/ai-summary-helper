#!/bin/bash
# Xcode build phase of the extension target: builds the Kaivo web extension for iOS from plugin/src and copies it into the
# extension bundle (manifest.json at its root).
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"   # Xcode's script phases do not see Homebrew
command -v node >/dev/null || { echo "error: node not found (install Node.js)" >&2; exit 1; }
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
node "$REPO/plugin/scripts/build.js" ios --kaivo
SRC="$REPO/plugin/dev/kaivo-extension-ios"
[ -f "$SRC/manifest.json" ] || { echo "error: $SRC/manifest.json missing" >&2; exit 1; }
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$DEST"
# The destination also holds the compiled Swift binary and Info.plist, so no --delete for it as a whole. Scripts and pages
# left from an earlier build go first, and each folder mirrors its source: a file removed from the extension must not ship.
find "$DEST" -maxdepth 1 -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' \) -delete
rsync -a --exclude '.DS_Store' "$SRC/" "$DEST/"
for dir in "$SRC"/*/; do
    rsync -a --delete --exclude '.DS_Store' "$dir" "$DEST/$(basename "$dir")/"
done
