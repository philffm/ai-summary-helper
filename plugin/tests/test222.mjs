// Anki export: cards from pinned answers and from the questions asked on the topic page; a file Anki imports; no duplicates on re-import.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const src = process.env.AISH_SRC;
const A = await import(pathToFileURL(path.join(src, 'modules/ankiExport.js')).href);

const art = { id: 'article_1_aaaaaa', title: 'Solar & grid <2026>', url: 'https://example.com/solar' };
const turns = [
    { id: 't1', q: 'What limits rooftop solar?', a: 'Grid connection.\nAnd "permits".', pinned: true },
    { id: 't2', q: 'Unpinned question', a: 'Not kept.', pinned: false },
    { id: 't3', q: '   ', a: 'no question', pinned: true }
];
const c1 = A.cardsFromTurns(art, turns);
assert.equal(c1.length, 1, 'only pinned turns with a question and an answer');
assert.equal(c1[0].front, 'What limits rooftop solar?');
assert.ok(c1[0].back.startsWith('Grid connection.<br>And "permits".'), 'line breaks become <br>, text stays text');
assert.ok(c1[0].back.includes('Solar &amp; grid &lt;2026&gt;') && c1[0].back.includes('https://example.com/solar'), 'the source is named, escaped');
assert.equal(A.cardsFromTurns(art, turns)[0].id, c1[0].id, 'the card id is stable');

const c2 = A.cardsFromResults([
    { question: 'How do tariffs differ?', text: 'They differ by [1] and [2].', articles: [art, { title: 'Other', url: 'https://x.example/o' }] },
    { text: 'A briefing without a question', articles: [art] }
], 'Solar');
assert.equal(c2.length, 1, 'a briefing without a question is not a card');
assert.ok(c2[0].back.includes('1. Solar &amp; grid &lt;2026&gt;; 2. Other'), 'sources listed by number');

const file = A.ankiFile({ deck: 'AI Summary Helper::Solar', tags: ['Solar power', 'a/b'], cards: [...c1, ...c2, ...c1] });
const lines = file.split('\n');
assert.deepEqual(lines.slice(0, 6), ['#separator:tab', '#html:true', '#guid column:1', '#notetype:Basic', '#deck:AI Summary Helper::Solar', '#tags column:4'], 'Anki import directives');
const rows = lines.slice(6).filter(Boolean);
assert.equal(rows.length, 2, 'a card that is in twice is written once');
rows.forEach(r => assert.equal(r.split('\t').length, 4, 'id, front, back, tags: ' + r.slice(0, 40)));
assert.ok(rows[0].endsWith('\taish Solar_power ab'), 'tags: no spaces inside a tag, odd characters dropped');
assert.ok(/""permits""/.test(rows[0]), 'a quote is written as two quotes inside a quoted field');
assert.ok(!rows.some(r => /\n/.test(r)), 'no raw line breaks inside a row');
assert.ok(file.endsWith('\n'));

// collectCards reads the pinned turns from storage
const store = { ['articles:rec:' + art.id]: { conversation: turns } };
globalThis.chrome = { storage: { local: { get(k, cb) { const o = {}; [].concat(k).forEach(x => { if (x in store) o[x] = store[x]; }); cb(o); } } } };
const all = await A.collectCards({ articles: [art, { id: 'x', feedStub: true }, { id: 'noconv' }], results: [{ question: 'Q?', text: 'A.', articles: [] }], topic: 'Solar' });
assert.equal(all.length, 2, 'one pinned turn from storage + one asked question; feed stubs and articles without a conversation add nothing');
assert.equal(await A.exportAnki({ articles: [{ id: 'noconv' }], results: [], topic: 'Solar' }), 0, 'nothing to export: no file, count 0');
console.log('anki ok');
