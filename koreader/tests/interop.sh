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
# the browser syncs: what the reader sent arrives in the extension
node "$here/browser-step.mjs" "$work/place/browser.json" "$work/dav/My Library" report > "$work/report.json"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), assert = require("assert");
const ko = r.annotations.find((a) => a.source === "koreader");
assert(ko, "the reader highlight is in the browser");
assert.equal(ko.text, "Short naps of about twenty minutes"); assert.equal(ko.type, "user"); assert.equal(ko.url, "https://science.example/sleep");
assert.equal(ko.quote.exact, ko.text); assert.match(ko.quote.prefix, /neurons\.\s*$/); assert.match(ko.quote.suffix, /^\s*improve recall/);
assert.equal(r.notes["c_" + ko.id].text, "Try it this week."); assert.equal(r.notes["c_" + ko.id].highlightId, ko.id);
assert.equal(r.notes["c_h-1"].text, "Matches chapter 3 - and chapter 5.", "comment edited on the reader");
assert.equal(r.annotations.find((a) => a.id === "h-2").dismissed, true, "AI highlight removed on the reader: dismissed");
assert(r.readAt["k-a1"], "opened on the reader: read"); assert(!r.readAt["k-a3"], "not opened: not read");
console.log("BROWSER SEES THE READER OK");
' "$work/report.json"
node "$here/browser-step.mjs" "$work/place/browser.json" "$work/dav/My Library" edit > /dev/null
AISH_PHASE=plugin2 luajit "$here/test_plugin.lua"
echo "INTEROP OK"
