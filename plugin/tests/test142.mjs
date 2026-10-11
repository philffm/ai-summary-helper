// Stable item identity: the id an item got when first seen survives reordering, a rewritten guid, changing tracking
// parameters and a rewritten link; different podcast episodes that share one link are never merged.
import assert from 'assert'; import path from 'path'; import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const { reconcileItemIds, mergeWorkerItems, feedItemId } = await import(pathToFileURL(path.join(SRC, 'modules/feedWorker.js')).href);
const sub = { id: 'feedA' };
const NOW = Date.parse('2026-10-11T12:00:00Z');
const mk = (o) => ({ title: 'T', link: '', guid: '', published: 0, audio: '', feedId: 'feedA', ...o });
const store = (items) => items.map(i => ({ ...i, read: true, ai: true, sent: 0.4 }));

// 1. unchanged guid, other order → same ids (position is irrelevant)
const first = reconcileItemIds(sub, [mk({ guid: 'g1', link: 'https://x.test/1', title: 'One', published: NOW }), mk({ guid: 'g2', link: 'https://x.test/2', title: 'Two', published: NOW - 1000 })]);
const stored = store(first);
const again = reconcileItemIds(sub, [mk({ guid: 'g2', link: 'https://x.test/2', title: 'Two', published: NOW - 1000 }), mk({ guid: 'g1', link: 'https://x.test/1', title: 'One', published: NOW })], stored);
assert.deepEqual(again.map(i => i.id), [first[1].id, first[0].id], 'same ids whatever the order');
assert.equal(first[0].id, feedItemId(sub, { guid: 'g1', link: 'https://x.test/1' }), 'ids of items with a guid are exactly what they were');

// 2. the publisher rewrote the guid, the link is the same → same item
const rot = reconcileItemIds(sub, [mk({ guid: 'NEW-g1', link: 'https://x.test/1?utm_source=rss', title: 'One', published: NOW })], stored);
assert.equal(rot.length, 1); assert.equal(rot[0].id, first[0].id, 'rewritten guid keeps the id');

// 3. no guid, tracking parameters change on every fetch → still one item
const a = reconcileItemIds(sub, [mk({ link: 'https://x.test/post?utm_campaign=a', title: 'P', published: NOW })]);
const b = reconcileItemIds(sub, [mk({ link: 'https://x.test/post?utm_campaign=b&fbclid=zz', title: 'P', published: NOW })], store(a));
assert.equal(b[0].id, a[0].id, 'tracking parameters do not make a new item');

// 4. guid and link both rewritten, title and time are the same → same item
const c = reconcileItemIds(sub, [mk({ guid: 'old', link: 'https://x.test/old-url', title: 'Same headline', published: NOW })]);
const d = reconcileItemIds(sub, [mk({ guid: 'new', link: 'https://x.test/moved/new-url', title: 'Same headline', published: NOW })], store(c));
assert.equal(d[0].id, c[0].id, 'same title and time: same item');

// 5. a podcast: every episode links to the show page; different audio → different items, never merged
const ep = (n) => mk({ guid: 'ep' + n, link: 'https://pod.test/show', title: 'Episode ' + n, published: NOW - n * 86400000, audio: `https://cdn.test/ep${n}.mp3` });
const eps = reconcileItemIds(sub, [ep(1), ep(2), ep(3)]);
assert.equal(new Set(eps.map(i => i.id)).size, 3, 'three episodes, three ids');
const next = reconcileItemIds(sub, [ep(4), ep(1), ep(2), ep(3)], store(eps));
assert.deepEqual(next.slice(1).map(i => i.id), eps.map(i => i.id), 'old episodes keep their ids when a new one arrives');
assert(!eps.map(i => i.id).includes(next[0].id), 'the new episode is a new item although it shares the link');
// a feed with a single episode, whose guid was rewritten: the show link alone must not pull in an older, different episode
const lone = reconcileItemIds(sub, [mk({ guid: 'ep9', link: 'https://pod.test/show', title: 'Episode 9', published: NOW, audio: 'https://cdn.test/ep9.mp3' })], store(eps));
assert(!eps.map(i => i.id).includes(lone[0].id), 'different audio: a new item');

// 6. the same item listed twice in one fetch
assert.equal(reconcileItemIds(sub, [mk({ guid: 'g1', link: 'https://x.test/1', title: 'One' }), mk({ guid: 'g1', link: 'https://x.test/1', title: 'One' })]).length, 1);

// 7. state follows the item through mergeWorkerItems (the background run): one entry, still read, new link kept
const existing = store(first);
const merged = mergeWorkerItems(existing, reconcileItemIds(sub, [mk({ guid: 'NEW-g1', link: 'https://x.test/1', title: 'One (edited)', published: NOW })], existing), 30, NOW);
const hit = merged.filter(i => i.feedId === 'feedA' && /One/.test(i.title));
assert.equal(hit.length, 1, 'not duplicated');
assert.equal(hit[0].read, true); assert.equal(hit[0].title, 'One (edited)');
// ...and mergeWorkerItems does the matching itself when it is handed items with new ids
const viaMerge = mergeWorkerItems(existing, [mk({ id: 'brand-new-id', guid: 'zzz', link: 'https://x.test/1', title: 'One', published: NOW })], 30, NOW);
assert.equal(viaMerge.filter(i => /^One/.test(i.title)).length, 1, 'merge reconciles identity by itself');
assert.equal(viaMerge.find(i => /^One/.test(i.title)).id, first[0].id);
console.log('TEST 142 OK');
