// The daily line under the greeting: the pure module (dayLine.js) and the recap's optional NOTE line (off unless asked for).
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const dl = await imp('modules/dayLine.js');
const fa = await imp('modules/feedAi.js');

// language of the collection
assert.equal(dl.collectionLang('de'), 'de'); assert.equal(dl.collectionLang('de-AT'), 'de'); assert.equal(dl.collectionLang('fr'), 'en'); assert.equal(dl.collectionLang(''), 'en');
assert(dl.QUOTES.en.length >= 12 && dl.QUOTES.de.length >= 12 && [...dl.QUOTES.en, ...dl.QUOTES.de].every(([t, by]) => t.length > 8 && by), 'every line has a source');

// the date picks the line; the same all day, another one tomorrow; never empty
const d1 = new Date(2026, 10, 24, 8), d2 = new Date(2026, 10, 24, 22), d3 = new Date(2026, 10, 25, 8);
const a = dl.dayLines({ now: d1, lang: 'en' }), b = dl.dayLines({ now: d2, lang: 'en' }), c = dl.dayLines({ now: d3, lang: 'en' });
assert.deepEqual(a, b, 'same date, same lines'); assert.notEqual(a[0].text, c[0].text, 'another day, another line');
assert(a.length >= 6 && a.every((l) => l.kind === 'quote'), 'quotes only when there is nothing else');
assert(/Seneca|Bacon|Goethe|Nietzsche|Laozi|Plato|Plutarch|Pliny|Weil|Addison|Pope|Hippocrates|Socrates|Kant|Marcus|Troly|Japanese/.test(a[0].by), 'with its source');
assert.notEqual(dl.dayLines({ now: d1, lang: 'de' })[0].text, a[0].text, 'German has its own collection');

// the recap note comes first; the user's own line leads one day in four and is reachable on the others
const note = dl.dayLines({ now: d1, lang: 'en', note: 'On this day in 1859 Darwin published On the Origin of Species.' });
assert.equal(note[0].kind, 'note'); assert.equal(note.length, a.length + 1);
const own = { text: 'Local-first means the data lives with you first.', by: 'blog.localfirst.dev' };
let leads = 0, reachable = 0;
for (let day = 0; day < 8; day++) { const ls = dl.dayLines({ now: new Date(2026, 0, 1 + day), lang: 'en', own }); if (ls[0].kind === 'own') leads++; if (ls.some((l) => l.kind === 'own')) reachable++; }
assert.equal(leads, 2, 'one day in four'); assert.equal(reachable, 8, 'always reachable with New line');
assert.equal(dl.dayLines({ now: d1, lang: 'en', own: { text: '  ' } }).some((l) => l.kind === 'own'), false, 'an empty line is not offered');
assert.equal(dl.dayLines({ now: d1, lang: 'en', own: { text: 'x'.repeat(500) } }).find((l) => l.kind === 'own').text.length, 200, 'cut at 200');
// New line steps on and wraps
assert.equal(dl.pickDayLine(a, 0), a[0]); assert.equal(dl.pickDayLine(a, 1), a[1]); assert.equal(dl.pickDayLine(a, a.length), a[0]); assert.equal(dl.pickDayLine(a, -1), a[a.length - 1]);
const r1 = dl.seeded(5), r2 = dl.seeded(5); assert.equal(r1(), r2(), 'the seeded generator repeats');

// the recap: parse the NOTE line (without cite markers), the prompt asks for it only when the setting is on
const parsed = fa.parseRecap('A short overview of the news.\n- Chips: a plant opens (News) [1]\nNOTE: On this day in 1859 Darwin published a book. [2]\nMOOD: mixed');
assert.equal(parsed.note, 'On this day in 1859 Darwin published a book.'); assert.equal(parsed.mood, 'neu'); assert(!/NOTE/.test(parsed.overview), 'the note is not part of the overview');
assert.equal(fa.parseRecap('Overview.\nMOOD: mixed').note, undefined, 'no note, no field');
const items = [{ id: 'a', title: 'Chipmaker opens plant', snippet: '' }]; const sub = () => 'News';
const seen = []; fa.setAiTransport(async ({ system, user }) => { seen.push({ system, user }); return 'Overview of the news.\n- Chips (News) [1]\nNOTE: A thought for today.\nMOOD: mixed'; });
await fa.generateRecap(items, sub, { rate: false });
assert(!/NOTE/.test(seen[0].system) && !/NOTE/.test(seen[0].user), 'off by default: the prompt does not ask for a note');
store['feeds:settings'] = { recapNote: true };
const withNote = await fa.generateRecap(items, sub, { rate: false });
assert(/NOTE: one short sentence/.test(seen[1].system) && /historical event that happened on this calendar date \(\w+ \d+\)/.test(seen[1].system) && /certain/.test(seen[1].system), 'on: a thought or a historical fact for today, only if certain');
assert(/the NOTE line, and the MOOD line/.test(seen[1].user), 'repeated at the end of the prompt'); assert.equal(withNote.note, 'A thought for today.', 'kept in the recap');
const upd = await fa.generateRecapUpdate({ overview: 'Earlier.', themes: [], mood: 'neu', refs: {}, covered: {}, note: 'Yesterday note' }, items, sub, { rate: false });
assert.equal(upd.note, 'A thought for today.', 'the update brings its own note');
fa.setAiTransport(async () => 'Overview.\n- X (News) [+1]\nMOOD: mixed');
const keep = await fa.generateRecapUpdate({ overview: 'Earlier.', themes: [], mood: 'neu', refs: {}, covered: {}, note: 'Kept note' }, items, sub, { rate: false });
assert.equal(keep.note, 'Kept note', 'an update without a note keeps the one the recap has');
fa.setAiTransport(null);
console.log('TEST 283 OK');
