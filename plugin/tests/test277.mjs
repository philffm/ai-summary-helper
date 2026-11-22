// Feed briefing citations: markers resolve to item ids (fresh and refresh), stay stable, are stripped for the roll-up, and become chips.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const C = await imp('../src/modules/recapCites.js');
const chunk = [{ id: 'i1', title: 'One', link: 'https://a.com/1' }, { id: 'i2', title: 'Two', link: 'https://b.com/2' }, { id: 'i3', title: 'Three', link: 'https://c.com/3' }];

// a fresh recap: [k] → item k; markers outside the list are dropped, and only cited refs are kept
let r = C.resolveCites({ overview: 'Prices rose.[1][3] Odd marker [9].', themes: ['Chips fell [2]', 'No cite'] }, chunk);
assert.equal(r.overview, 'Prices rose.[1][3] Odd marker.', 'a marker that points to nothing is removed with its space');
assert.deepEqual(r.refs, { 1: 'i1', 2: 'i2', 3: 'i3' }, 'refs map the numbers to item ids');
assert.equal(r.themes[1], 'No cite');

// a refresh: the new items are cited as [+k] and continue the old numbering; old markers stay while their ref is known
const fresh = [{ id: 'n1', title: 'New', link: 'https://d.com/n' }];
const r2 = C.resolveCites({ overview: 'Prices rose.[1] A new story [+1]. Stale [7].', themes: ['Chips fell [2]'] }, fresh, r.refs);
assert.equal(r2.overview, 'Prices rose.[1] A new story [4]. Stale.', '[+1] becomes 3 + 1');
assert.equal(r2.refs[4], 'n1'); assert.equal(r2.refs[1], 'i1'); assert(!('3' in r2.refs), 'an item no longer cited is not kept');
assert.equal(C.maxRef({ 2: 'x', 10: 'y' }), 10);
assert.equal(C.stripCites('Prices rose.[1][3] Chips [+2] fell.'), 'Prices rose. Chips fell.', 'a roll-up never sees the markers');

// sources in order of first appearance
const byId = new Map([...chunk, ...fresh].map((i) => [i.id, i]));
assert.deepEqual(C.citedSources(r2, byId).map((s) => s.n), [1, 4, 2]);

// chips
const d = w.document; const box = d.createElement('div'); box.innerHTML = '<p>Prices rose.[1] Unknown [5] and <strong>bold [2]</strong>.</p>'; d.body.append(box);
C.chipCites(box, r, byId);
const chips = [...box.querySelectorAll('a.rc-cite')];
assert.deepEqual(chips.map((a) => a.textContent), ['1', '2'], 'known markers become chips');
assert(chips[0].href === 'https://a.com/1' && /One — a\.com/.test(chips[0].title), 'a chip opens the item and names it');
assert(!/\[\d\]/.test(box.textContent), 'no raw marker is left (an unknown one is dropped)');
console.log('TEST 277 OK'); process.exit(0);
