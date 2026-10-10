// Settings: accessibility has its own panel (home row, panel, search index); Appearance keeps theme, language, symbol style.
import assert from 'assert'; import fs from 'fs'; import path from 'path';
import { SRC } from './harness.mjs';
const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
const panel = (id) => { const a = html.indexOf(`id="settingsPanel-${id}"`); assert(a > 0, 'panel ' + id); return html.slice(html.lastIndexOf('<section', a), html.indexOf('</section>', a) + 10); };
const acc = panel('accessibility'), app = panel('appearance');
for (const id of ['a11yStatus', 'profileList', 'textScaleRange', 'lineSeg', 'readableFontToggle', 'reduceMotionToggle', 'a11yPreview']) {
  assert(acc.includes(`id="${id}"`), id + ' is in the Accessibility panel');
  assert(!app.includes(`id="${id}"`), id + ' is no longer in Appearance');
}
for (const id of ['themeSeg', 'uiLangSelect', 'iconSeg', 'nativeSidePanelToggle']) assert(app.includes(`id="${id}"`), id + ' stays in Appearance');
assert(/<button[^>]*class="settings-row"[^>]*data-panel="accessibility"/.test(html), 'home row');
assert(/data-sub="accessibility"/.test(html));
assert(/data-back/.test(acc), 'back button');
const nav = fs.readFileSync(path.join(SRC, 'modules/settingsNav.js'), 'utf8');
assert(/\['accessibility', N_\('Text size'\), 'textScaleRange'/.test(nav) && /accessibility: N_\('Accessibility'\)/.test(nav), 'search index + title');
for (const m of nav.matchAll(/\['accessibility', N_\('[^']+'\), '([A-Za-z0-9]+)'/g)) assert(html.includes(`id="${m[1]}"`), 'search target exists: ' + m[1]);
console.log('TEST 121 OK'); process.exit(0);
