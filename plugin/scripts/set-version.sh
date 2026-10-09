#!/bin/bash
# Stamp one version into every file that carries it: the four platform manifests, current_version.json and the
# version label in popup.html. Idempotent; used by build.sh and by the release workflow, which re-applies it onto
# the latest main instead of rebasing a bump commit.
#   plugin/scripts/set-version.sh 2.1.20
set -euo pipefail
VERSION="${1:?usage: set-version.sh <version>}"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "not a version: $VERSION" >&2; exit 1; }
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$PLUGIN_DIR/.." && pwd)"

# Portable in-place sed (BSD sed on macOS, GNU sed on Linux)
inplace_sed() {
  if [[ "$(uname)" == "Darwin" ]]; then sed -i '' "$1" "$2"; else sed -i "$1" "$2"; fi
}

for platform in chrome android firefox ios; do
  inplace_sed "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PLUGIN_DIR/platforms/$platform/manifest.json"
done
jq ".version = \"$VERSION\"" "$REPO_DIR/current_version.json" > "$REPO_DIR/current_version.json.tmp"
mv "$REPO_DIR/current_version.json.tmp" "$REPO_DIR/current_version.json"
inplace_sed "s|<span id=\"versionNumber\">[^<]*</span>|<span id=\"versionNumber\">$VERSION</span>|" "$PLUGIN_DIR/src/popup.html"
