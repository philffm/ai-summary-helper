// Tab bar: the active indicator slides from its previous spot; both screens use it.
import { setup, imp } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { w } = setup({}); const d = w.document;
Object.defineProperty(w.HTMLElement.prototype, 'offsetLeft', { get() { return Number(this.dataset.x || 0); } });
Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return Number(this.dataset.w || 0); } });
const { syncTabbar } = await imp('modules/tabbar.js');
const make = (active) => { const s = d.createElement('div'); s.className = 'tabbar'; s.dataset.tabbar = 'k1'; [['a', 0, 90], ['b', 90, 90], ['c', 180, 90]].forEach(([id, x, wd]) => { const b = d.createElement('button'); b.className = 'tabbar-btn' + (id === active ? ' on' : ''); b.dataset.x = x; b.dataset.w = wd; s.appendChild(b); }); d.body.appendChild(s); return s; };
let s = make('a'); syncTabbar(s);
assert(s.querySelector('.tabbar-ind') && s.classList.contains('tb-ready')); assert.equal(s.style.getPropertyValue('--tb-x'), '14px'); assert.equal(s.style.getPropertyValue('--tb-w'), '62px');
s.children[1].classList.remove('on'); s.children[2].classList.add('on'); syncTabbar(s);
assert.equal(s.style.getPropertyValue('--tb-x'), '104px');
s.remove(); const seen = []; const s2 = make('c'); const o = s2.style.setProperty.bind(s2.style); s2.style.setProperty = (k, v) => { if (k === '--tb-x') seen.push(v); o(k, v); };
syncTabbar(s2); assert.deepEqual(seen, ['104px', '194px'], 'slides from previous spot: ' + seen); assert(!s2.classList.contains('tb-nomove'));
const s3 = d.createElement('div'); s3.className = 'tabbar'; d.body.appendChild(s3); syncTabbar(s3); assert(!s3.classList.contains('tb-ready'));
const css = fs.readFileSync(process.env.AISH_SRC + '/styles.css', 'utf8');
assert(/\.tabbar-ind \{[^}]*var\(--nav-blob-bg\)/.test(css));
// both screens use it
const html = fs.readFileSync(process.env.AISH_SRC + '/popup.html', 'utf8'); assert(/id="feedScopeRow" class="feed-scope tabbar"/.test(html));
console.log('TEST 37 OK');
