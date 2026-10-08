// Suggested follow-ups with a short answer: tolerant parsing ({q,a}, plain strings, broken JSON), parseAnswer carries them,
// the full-answer prompt sees the short one, and the typewriter types unevenly and can be sped up / stopped.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const { parseSuggestionList } = await imp('modules/suggestions.js');
const { parseAnswer, buildPrompt } = await imp('modules/conversation.js');
const { typeText, typingDelay } = await imp('modules/typewriter.js');

// 1) objects
let r = parseSuggestionList('[{"q":"Who paid for it?","a":"The city paid for it. It was funded in 2019."},{"q":"How long did it take?","a":"Three years in total, mostly for permits."}]');
assert.deepEqual(r.questions, ['Who paid for it?', 'How long did it take?']);
assert.equal(r.quick['Who paid for it?'], 'The city paid for it. It was funded in 2019.');
// 2) old format: strings only → no short answers
r = parseSuggestionList('["Who paid for it?", "How long did it take?", "x"]');
assert.deepEqual(r.questions, ['Who paid for it?', 'How long did it take?']); assert.deepEqual(r.quick, {});
// 3) truncated JSON (stream cut) keeps complete pairs and never turns the keys into questions
r = parseSuggestionList('```json\n[{"q":"Why now?","a":"Because the law changed last year."},{"q":"What next?","a":"The cou');
assert.deepEqual(r.questions, ['Why now?', 'What next?'].slice(0, r.questions.length)); assert(r.questions.includes('Why now?'));
assert(!r.questions.some(q => q === 'q' || q === 'a'), 'no JSON keys as questions');
assert.equal(r.quick['Why now?'], 'Because the law changed last year.');
// 4) escaped quotes inside the answer, max 3 entries, de-duplicated
r = parseSuggestionList('[{"q":"A one?","a":"He said \\"yes\\" to it twice."},{"q":"A one?","a":"dup dup dup dup"},{"q":"B two?","a":"x"},{"q":"C three?","a":"Third answer here."},{"q":"D four?","a":"Fourth answer here."}]');
assert.deepEqual(r.questions, ['A one?', 'B two?', 'C three?']);
assert.equal(r.quick['A one?'], 'He said "yes" to it twice.'); assert(!('B two?' in r.quick), 'too short answers are dropped');

// parseAnswer: answer text, sources and suggestions with short answers
const raw = 'Because of the code.\nSOURCES: "The challenge was never the design; it was the code"\nQUESTIONS: [{"q":"Who paid for it?","a":"The city did. It was funded in 2019."}]';
const pa = parseAnswer(raw, 'The challenge was never the design; it was the code and more.');
assert.equal(pa.a, 'Because of the code.'); assert.deepEqual(pa.questions, ['Who paid for it?']); assert.equal(pa.quick['Who paid for it?'], 'The city did. It was funded in 2019.');
assert.equal(pa.sources.length, 1);

// the full-answer prompt knows the short answer that is already on screen
const p = buildPrompt({ title: 'T', content: '<p>x</p>', summary: '<p>s</p>', turns: [], question: 'Who paid for it?', draft: 'The city did.' });
assert(/ALREADY SEES[\s\S]*The city did\./.test(p.user)); assert(!/ALREADY SEES/.test(buildPrompt({ content: '', summary: '', question: 'q' }).user));
assert(/"q":"question 1","a":"answer 1"/.test(p.system), 'follow-up replies ask for short answers too');

// typewriter: uneven delays, longer after sentences, deterministic with a fixed rnd
assert(typingDelay('.', () => 0.5) > typingDelay('a', () => 0.5) + 150, 'pause after a sentence');
const ds = new Set(Array.from({ length: 40 }, () => Math.round(typingDelay('a'))));
assert(ds.size > 8, 'key timing varies');
const timers = []; let now = 0; const log = [];
const t1 = typeText('Hi there. Ok', (s) => log.push(s), { rnd: () => 0.5, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
let guard = 0; while (timers.length && guard++ < 100) { const { fn } = timers.shift(); fn(); }
assert.equal(log[log.length - 1], 'Hi there. Ok'); assert(log.length >= 12 && log[0] === 'H', 'typed char by char');
assert.equal(await t1.done, true);
// fast mode jumps 4 chars at a time
const log2 = []; const q2 = []; const t2 = typeText('abcdefgh', (s) => log2.push(s), { fast: () => true, rnd: () => 0, setTimer: (fn) => { q2.push(fn); return 1; }, clearTimer: () => {} });
guard = 0; while (q2.length && guard++ < 10) q2.shift()();
assert.deepEqual(log2, ['abcd', 'abcdefgh']);
// stop() ends it without finishing; instant shows everything at once
const q3 = []; const t3 = typeText('abc', () => {}, { setTimer: (fn) => { q3.push(fn); return 1; }, clearTimer: () => {} }); t3.stop(); assert.equal(await t3.done, false);
const log4 = []; const t4 = typeText('abc', (s) => log4.push(s), { instant: true }); assert.deepEqual(log4, ['abc']); assert.equal(await t4.done, true);
console.log('TEST 81 OK');
