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
assert.deepEqual(labels.filter(c => !/kindle/.test(c)), ['open-button', 'copy-button', 'share-button', 'localsend-button'], 'no .MD button; the ⋯ menu (now the toolbar\'s last segment) carries the rest');
assert(d.querySelector('#detailTopActions > .card-menu-btn'), 'the joined toolbar is used at every width, with ⋯ at its end');
assert(d.querySelector('.action-bar .open-button').classList.contains('button-secondary'));
const sc = d.querySelector('.source-card');
assert(sc, 'combined source card');
for (const k of ['facts', 'cite', 'check']) { const s = sc.querySelector('details.source-sec-' + k); assert(s && s.querySelector('summary'), k + ' present'); assert.equal(s.open, k === 'facts', k + (k === 'facts' ? ' open (the article has a DOI)' : ' collapsed by default')); }
assert(sc.querySelector('.cite-block'));
assert(sc.querySelector('.source-doi'), 'DOI shown in the card summary');
// non-paper: Source + Check only, DOI can be entered in the card
store['articles:index'].push({ id: 'a2', url: 'https://x.com/2', title: 'Plain', timestamp: iso(0), summary: '<p>two</p>', tags: [] });
await am.showArticleDetail({ ...store['articles:index'][1] }); await tick(100);
const sc2 = d.querySelector('.source-card');
assert(sc2 && sc2.classList.contains('no-paper') && !sc2.querySelector('.source-sec-facts') && sc2.querySelector('.source-sec-check:not([open])'), 'non-paper card: check only');
assert(sc2.querySelector('.source-doi-add'), '+ DOI button in the card');
// wide top bar: actions move up once and are not duplicated when another article is opened
{
  const tb = d.getElementById('detailTopBar');
  tb.getBoundingClientRect = () => ({ width: 900, height: 50, top: 0, left: 0, right: 900, bottom: 50 });
  await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(60);
  await am.showArticleDetail({ ...store['articles:index'][1] }); await tick(60);
  await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(60);
  assert.equal(d.querySelectorAll('#detailTopBar .tool-read').length, 1, 'one Read button in the top bar');
  assert.equal(d.querySelectorAll('#detailTopBar .tool-copy').length, 1, 'one Copy button in the top bar');
  assert.equal(d.querySelectorAll('#detailTopBar .card-menu-btn').length, 1, 'one ⋯ button in the top bar');
  const toolId = (b) => b.id === 'detailStarBtn' ? 'favorite' : b.id === 'detailListenBtn' ? 'listen' : (b.className.match(/tool-(\w+)/) || [])[1];
  const tools = [...d.querySelectorAll('#detailTopActions > .detail-tool')].map(toolId);
  assert.deepEqual(tools.slice(0, 3), ['read', 'copy', 'favorite'], 'Read / Copy come first: ' + tools);
  assert(d.querySelector('#detailTopActions').lastElementChild.classList.contains('card-menu-btn'), '⋯ is the last segment');
  {   // the buttons really run their action (Read opens the reader page in a tab)
    const opened = []; globalThis.chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p; globalThis.chrome.tabs = { ...(globalThis.chrome.tabs || {}), create: async (o) => { opened.push(o.url); } };
    d.querySelector('#detailTopActions .tool-read').click(); await tick(80);
    assert(opened.some(u => /readerPage\.html#id=a1/.test(u)), 'Read opens the reader: ' + JSON.stringify(opened));
  }
  assert(d.querySelector('#detailTopActions #detailStarBtn'), 'favorite button is part of the toolbar');
  assert(d.querySelector('#detailTopActions #detailListenBtn'), 'read-aloud button is part of the toolbar');
  {   // customize: ⋯ → "Customize toolbar…" turns the bar into the editor
    d.querySelector('#detailTopActions .card-menu-btn').click(); await tick(30);
    const item = [...d.querySelectorAll('.card-menu-item')].find(b => /Customize toolbar/.test(b.textContent));
    assert(item, 'menu offers Customize toolbar…'); item.click(); await tick(60);
    assert(d.getElementById('toolbarTray') && d.querySelector('#detailTopActions.is-editing'), 'edit mode: tray + editing bar');
    const before = [...d.querySelectorAll('#detailTopActions .is-editable')].map(b => b.dataset.toolId);
    const chip = d.querySelector('#toolbarTray .toolbar-chip'); assert(chip, 'tray lists the actions that are only in ⋯');
    const id = chip.dataset.toolId; chip.click(); await tick(60);
    assert(store.detailToolbarItems && store.detailToolbarItems.includes(id), 'adding saves the list');
    assert.equal(d.querySelectorAll('#detailTopActions .is-editable').length, before.length + 1);
    const first = d.querySelector('#detailTopActions .is-editable');
    first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); await tick(60);
    assert(!d.querySelector('#toolbarTray [data-tool-id="read"]') === false, 'removed action is back in the tray');
    d.querySelector('#toolbarTray .button-primary').click(); await tick(40);
    assert(!d.getElementById('toolbarTray') && !d.querySelector('#detailTopActions.is-editing'), 'Done leaves edit mode');
    delete store.detailToolbarItems;
  }
  {   // Send menu lists the paired devices per send type: three, the rest behind "N more…"
    store['send:devices'] = [1, 2, 3, 4, 5].map(n => ({ id: 'k' + n, type: 'kindle', label: 'K' + n, address: 'mailto:k' + n + '@kindle.com' })).concat([{ id: 'l1', type: 'localsend', label: 'Pixel', addresses: ['1.2.3.4'] }]);
    await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(60);
    d.querySelector('#detailTopActions .detail-split-more').click(); await tick(80);
    const names = () => [...d.querySelectorAll('.card-menu-item')].map(b => b.textContent);
    let n = names();
    assert(n.some(t => /K1/.test(t)) && n.some(t => /K3/.test(t)) && !n.some(t => /K4/.test(t)), 'three kindle devices: ' + JSON.stringify(n));
    assert(n.some(t => /Pixel/.test(t)), 'localsend device listed');
    const more = [...d.querySelectorAll('.card-menu-item')].find(b => /2 more/.test(b.textContent)); assert(more, 'N more… entry');
    more.click(); await tick(120);
    n = names(); assert(n.some(t => /K5/.test(t)), 'expanded list shows all devices: ' + JSON.stringify(n));
    delete store['send:devices'];
  }
  // configured list: own order, own selection
  store.detailToolbarItems = ['pdf', 'copy', 'bogus'];
  await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(60);
  assert.deepEqual([...d.querySelectorAll('#detailTopActions > .detail-tool')].map(toolId), ['pdf', 'copy'], 'configured toolbar');
  assert(d.querySelector('#detailTopBar > #detailStarBtn'), 'favorite goes back to the bar when it is not configured');
  delete store.detailToolbarItems;
}
console.log('TEST 69 OK');
// profile switching: no leftovers (high contrast theme / reduce motion) — logic mirrored from settingsManager
const src = fs.readFileSync(new URL('../src/modules/settingsManager.js', import.meta.url), 'utf8');
assert(/default: \(\) => \(\{ theme: leaveContrast\(\)/.test(src) && /large: \(\) => \(\{ theme: leaveContrast\(\), textScale: 125, lineSpacing: 'relaxed', reduceMotion: false/.test(src), 'profiles reset theme + motion');
assert(/--range-progress/.test(src), 'slider fill follows value');
// every locale has every English key (graph/settings labels used to be missing in ar/it/ru/zh_HK)
{
  const dir = new URL('../src/_locales/', import.meta.url);
  const en = JSON.parse(fs.readFileSync(new URL('en/messages.json', dir), 'utf8'));
  for (const l of fs.readdirSync(dir).filter(x => !x.startsWith('.') && x !== 'en')) {
    const d = JSON.parse(fs.readFileSync(new URL(l + '/messages.json', dir), 'utf8'));
    const miss = Object.keys(en).filter(k => !(k in d));
    assert.equal(miss.length, 0, l + ' is missing ' + miss.slice(0, 5).join(','));
  }
}
console.log('TEST 69 locales OK');
