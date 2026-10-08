// Feeds: a dictionary that arrives after a row was built still updates that row.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const now = Date.now();
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'A', lastFetched: now }];
store['feeds:items'] = [{ id: 'a', feedId: 's1', title: 'H', link: 'https://x/1', published: now - 1000, snippet: 's', read: false }];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
const labels = () => [...w.document.querySelectorAll('#feedScopeRow .feed-scope-btn')].map(b => b.textContent);
assert.deepEqual(labels(), ['Feed', 'Day', 'Week', 'Month']);
// simulate the dictionary arriving after the row was built
const i18n = await import(process.env.AISH_SRC + '/modules/i18n.js');
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(require_fs(u)) });
function require_fs(u) { return globalThis.__fs.readFileSync(process.env.AISH_SRC + '/' + u, 'utf8'); }
globalThis.__fs = (await import('fs')).default;
await i18n.applyTranslations('de'); await tick(50);
assert.deepEqual(labels(), ['Feed', 'Tag', 'Woche', 'Monat'], labels().join());
console.log('TEST 26 OK');
