#!/bin/bash
# Xcode build phase of the app target: bundles the extension's sync modules for the app (js/appSync.js -> app-sync.js).
set -euo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"   # Xcode's script phases do not see Homebrew
command -v node >/dev/null || { echo "error: node not found (install Node.js)" >&2; exit 1; }
IOS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$IOS/../../plugin/scripts/build.js" --module-bundle "$IOS/js/appSync.js" AISH_APP \
    "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/app-sync.js"
