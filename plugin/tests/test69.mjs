// Accessibility prefs (modules/a11y.js), popup.html wiring, detail view layout (⋯ menu, action order, collapsed paper details).
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const a = await imp('../src/modules/a11y.js');
const root = w.document.documentElement;
a.applyA11y({ theme: 'contrast', textScale: 120, lineSpacing: 'relaxed', readableFont: true, reduceMotion: true }, root);
assert.equal(root.getAttribute('data-theme'), 'contrast');
assert.equal(root.style.getPropertyValue('--text-scale'), '1.2');
assert.equal(root.getAttribute('data-line'), 'relaxed'); assert.equal(root.getAttribute('data-font'), 'readable'); assert.equal(root.getAttribute('data-motion'), 'reduce');
a.applyA11y({ theme: '', textScale: 100, lineSpacing: 'normal' }, root);
for (const at of ['data-theme', 'data-line', 'data-font', 'data-motion']) assert(!root.hasAttribute(at), at);
assert(!root.style.getPropertyValue('--text-scale'));
assert.equal(a.clampScale(500), 150); assert.equal(a.clampScale(10), 85); assert.equal(a.clampScale('x'), 100);
// popup.html: controls exist, flags in the UI language list
const html = fs.readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
for (const id of ['textScaleRange', 'readableFontToggle', 'reduceMotionToggle', 'themeSeg', 'lineSeg', 'profileList', 'a11yCustom', 'a11yStatus', 'detailMoreBtn', 'detailMoreMenu']) assert(html.includes('id="' + id + '"'), id);
assert(/value="de">🇩🇪 Deutsch/.test(html) && /value="ja">🇯🇵 日本語/.test(html));
assert(/data-value="contrast"/.test(html));
assert(html.indexOf('id="uiLangSelect"') < html.indexOf('id="themeSeg"') && html.indexOf('id="themeSeg"') < html.indexOf('id="profileList"'), 'order: language, theme, profiles');
assert(['default', 'large', 'contrast', 'calm'].every(p => html.includes('data-profile="' + p + '"')));
assert(html.indexOf('id="profileList"') < html.indexOf('id="a11yCustom"') && html.indexOf('id="a11yCustom"') < html.indexOf('id="textScaleRange"'), 'controls live inside Customize');
// detail view
const iso = (d) => new Date(Date.now() - d).toISOString();
store['articles:index'] = [{ id: 'a1', url: 'https://x.com/1', title: 'Paper one', timestamp: iso(0), summary: '<p>one</p>', tags: [], paper: 'yes', doi: '10.1038/s41562-026-0000-0' }];
const am = await imp('../src/modules/articleManager.js');
await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(100);
const d = w.document;
const labels = [...d.querySelectorAll('.action-bar button')].map(b => b.className.split(' ')[1] || b.className);
assert.deepEqual(labels.filter(c => !/kindle/.test(c)), ['open-button', 'copy-button', 'md-button', 'share-button', 'localsend-button']);
assert(d.querySelector('.action-bar .open-button').classList.contains('button-secondary'));
const pd = d.querySelector('details.paper-details');
assert(pd && !pd.open, 'paper details collapsed by default');
assert(pd.querySelector('.cite-block') && pd.querySelector('summary'));
console.log('TEST 69 OK');
