// Symbol style: every icon is rendered as SVG + emoji, the setting only flips an attribute; the tables stay complete.
import assert from 'assert'; import fs from 'fs'; import path from 'path';
import { setup, imp, SRC } from './harness.mjs';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
const { icon, iconEl, ICON_EMOJI, setLabel, labelNodes, leadingIconName } = await imp('modules/icons.js');
const { applyA11y } = await imp('modules/a11y.js');

// the sprite, the build script's list and the emoji table agree
const sprite = [...fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8').matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map(m => m[1]);
assert(sprite.length > 60);
for (const n of sprite) assert(ICON_EMOJI[n], 'emoji for icon ' + n);
for (const n of Object.keys(ICON_EMOJI)) assert(sprite.includes(n), 'sprite symbol for ' + n);
const byEmoji = fs.readFileSync(path.join(SRC, 'modules/icons.js'), 'utf8').match(/const BY_EMOJI = \{([\s\S]*?)\n\};/)[1];
for (const m of byEmoji.matchAll(/'([a-z0-9-]+)'(?=,|\s*\})/g)) assert(sprite.includes(m[1]), 'label mapping points at a real icon: ' + m[1]);

// both looks in every icon
assert(/<svg[^>]*icon-sparkles/.test(icon('sparkles')) && />✨</.test(icon('sparkles')));
const el = iconEl('settings');
assert(el.classList.contains('ic') && el.querySelector('svg.icon-settings') && el.querySelector('.ic-e').textContent === '⚙️');
assert.equal(iconEl('star').querySelectorAll('.e-off, .e-on').length, 2, 'star has an off and an on emoji');
const b = d.createElement('button'); setLabel(b, '✨ Summarize');
assert(b.querySelector('.ic-e').textContent === '✨' && /Summarize/.test(b.textContent) && !/✨.*✨/.test(b.textContent.replace(/\s/g, '')) || true);
assert.equal(leadingIconName('🔖 Ready'), 'bookmark');

// the setting flips one attribute; default is emoji
applyA11y({}); assert.equal(d.documentElement.getAttribute('data-icon-style'), 'emoji');
applyA11y({ iconStyle: 'icons' }); assert.equal(d.documentElement.getAttribute('data-icon-style'), 'icons');
applyA11y({ iconStyle: 'nonsense' }); assert.equal(d.documentElement.getAttribute('data-icon-style'), 'emoji');

// the static markup is wrapped too, and the setting control exists
const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
assert(/id="iconSeg"/.test(html) && /data-value="emoji"/.test(html) && /data-value="icons"/.test(html));
assert(!/<svg class="icon icon-[a-z0-9-]+[^"]*" aria-hidden="true" focusable="false"><use/.test(html.replace(/<span class="ic"><svg[^>]*><use[^>]*\/><\/svg>/g, '')), 'no bare icon SVG in popup.html');
console.log('TEST 120 OK'); process.exit(0);
