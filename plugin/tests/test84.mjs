// Save only (no AI): saved-only entries get a badge, and are replaced (favorite carried over) once summarized for real.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const AM = await imp('modules/articleManager.js');
const FM = await imp('modules/feedManager.js');
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const saved = { id: 'a1', title: 'T', url: 'https://x.example.com/p', summary: '', savedOnly: true, favorite: true, timestamp: '2026-10-01T00:00:00Z' };
const badges = AM.statusBadges(saved);
assert(badges.some(b => b[0] === 'saved'), 'saved badge: ' + JSON.stringify(badges));
assert(!AM.statusBadges({ ...saved, summary: '<p>Now</p>' }).some(b => b[0] === 'saved'), 'no badge once summarized');
const real = { id: 'a2', title: 'T', url: 'https://x.example.com/p', summary: '<p>Done</p>', timestamp: '2026-10-02T00:00:00Z' };
await new Promise(r => chrome.storage.local.set({ [SK.articlesIndex]: [saved, real], [articleRecKey('a1')]: { content: 'c' } }, r));
await FM.reconcileStubs();
const { [SK.articlesIndex]: idx } = await new Promise(r => chrome.storage.local.get(SK.articlesIndex, r));
assert.deepEqual(idx.map(a => a.id), ['a2']);
assert.equal(idx[0].favorite, true, 'favorite carried over');
console.log('TEST 84 OK');
