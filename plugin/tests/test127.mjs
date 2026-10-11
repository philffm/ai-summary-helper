// Whole-library run: an item that was scored but came back without a category is not sent again on every run (catTried).
import assert from 'assert';
import { readFileSync } from 'fs';
import { planLibrary } from '../src/modules/libraryBatch.js';

const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const now = Date.now();
const mk = (id, extra = {}) => ({ id, title: id, published: now - 3600000, ...extra });
const plan = (items) => planLibrary({ items, recaps: {}, source: 'all', inSource: () => true, startOfDay, itemSig: (i) => i.title });

const items = [
    mk('new'),                                   // never rated: needs a request
    mk('scoreOnly', { ai: true, sent: 0.3 }),    // scored, no category, not tried yet: one more attempt
    mk('tried', { ai: true, sent: 0.3, catTried: true }),   // scored, category asked once and not returned: leave alone
    mk('done', { ai: true, sent: 0.1, cat: 'Tech' }),
];
assert.deepEqual(plan(items).rate.map(i => i.id).sort(), ['new', 'scoreOnly']);
// an item that was tried but never got a score still needs rating
assert.deepEqual(plan([mk('noScore', { catTried: true })]).rate.map(i => i.id), ['noScore']);

// every place that stores a rating also remembers the attempt, so stopping and starting again shrinks the list
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const fm = src('../src/modules/feedManager.js'), bg = src('../src/background.js');
assert.ok((fm.match(/catTried = true/g) || []).length >= 3, 'feedManager marks catTried in applyRatings, scoring and the library rating');
assert.ok(/needsAi = \(i\) => !i\.ai \|\| \(!i\.cat && !i\.catTried\)/.test(fm), 'manual scoring uses the same rule');
assert.ok((bg.match(/catTried = true/g) || []).length >= 3, 'background run marks catTried');
assert.ok(/catTried/.test(bg.split('const saveRatings')[1].split('const aiCall')[0]), 'background run stores catTried with the ratings');
console.log('ok');
