#!/usr/bin/env bash
# The plugin against a place made by the extension's own sync engine, served by a real WebDAV server (wsgidav) with a login.
#   bash koreader/tests/interop.sh        (needs node, luajit with luasocket, and: pip install wsgidav cheroot)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$here/../.."
work="$(mktemp -d)"; trap 'kill $srv 2>/dev/null || true; rm -rf "$work"' EXIT
node "$repo/koreader/tests/make-place.mjs" "$work/place" >/dev/null
mkdir -p "$work/dav/My Library"
cat > "$work/dav.yaml" <<YAML
host: 127.0.0.1
port: 8766
provider_mapping: { "/": "$work/dav" }
http_authenticator: { domain_controller: null, accept_basic: true, accept_digest: false, default_to_digest: false }
simple_dc: { user_mapping: { "*": { "phil": { password: "app pass/ü" } } } }
verbose: 1
YAML
wsgidav --config "$work/dav.yaml" >"$work/dav.log" 2>&1 & srv=$!
for i in $(seq 1 50); do curl -s -o /dev/null http://127.0.0.1:8766/ && break; sleep 0.1; done
export AISH_URL="http://127.0.0.1:8766/" AISH_WORK="$work/device"
cp -r "$work/place/snap1/." "$work/dav/My Library/"
AISH_PHASE=1 luajit "$here/test_interop.lua"
# like a real server: only files whose content changed get a new ETag (unchanged files are left alone)
changed=0; for f in "$work/place/snap2/r/"*; do cmp -s "$f" "$work/place/snap1/r/$(basename "$f")" || { changed=$((changed+1)); cp "$f" "$work/dav/My Library/r/"; }; done
for f in "$work/dav/My Library/r/"*; do [ -e "$work/place/snap2/r/$(basename "$f")" ] || rm "$f"; done
AISH_CHANGED=$changed AISH_PHASE=2 luajit "$here/test_interop.lua"
AISH_PHASE=plugin luajit "$here/test_plugin.lua"
echo "INTEROP OK"
