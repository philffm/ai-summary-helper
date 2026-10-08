// Firefox: the real sidebar hosts popup.html; Chrome keeps sidePanel; the Chrome-only toggle hides where unsupported.
import assert from 'assert'; import fs from 'fs';
const root = new URL('../platforms/', import.meta.url).pathname;
const ff = JSON.parse(fs.readFileSync(root + 'firefox/manifest.json', 'utf8'));
assert.equal(ff.sidebar_action.default_panel, 'popup.html'); assert.equal(ff.sidebar_action.open_at_install, false);
assert(ff.sidebar_action.default_title && ff.sidebar_action.default_icon);
assert(!ff.permissions.includes('sidePanel'));
const ch = JSON.parse(fs.readFileSync(root + 'chrome/manifest.json', 'utf8'));
assert(ch.permissions.includes('sidePanel') && ch.side_panel && !ch.sidebar_action);
console.log('TEST 76 OK');
