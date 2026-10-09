// The whole-library run is linked from Settings › Library & Data › On-device tools and is findable in the settings search.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const html = fs.readFileSync(path.join(src, 'popup.html'), 'utf8');
const device = html.slice(html.indexOf('local-intelligence'), html.indexOf('danger-zone'));
assert(/id="libraryToolButton"/.test(device), 'button sits inside the On-device tools card');
const nav = fs.readFileSync(path.join(src, 'modules/settingsNav.js'), 'utf8');
assert(/'feedPrefsLibrary'/.test(nav) && /'libraryToolButton'/.test(nav), 'search entries for both places');
const mgr = fs.readFileSync(path.join(src, 'modules/settingsManager.js'), 'utf8');
assert(/openSettingsPanel\('feedprefs', 'feedPrefsLibrary'\)/.test(mgr), 'the button opens the Feed preferences card');
console.log('TEST 101 OK'); process.exit(0);
