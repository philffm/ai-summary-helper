// Speed-read (RSVP) timing and the "read later" reminder time: pure helpers for the rebuilt Speed-read / Später lesen flow.
import { imp } from './harness.mjs'; import assert from 'assert';
const R = await imp('modules/rsvp.js');
const D = await imp('modules/decisionTime.js');

// words, sentences, paragraphs
const b = R.rsvpBuild([{ text: 'Title here', heading: true }, { text: 'First sentence, with a comma. Second one!' }, { text: '  ' }]);
assert.equal(b.sentences.length, 3, 'heading + two sentences');
assert.equal(b.paragraphs.length, 2, 'empty blocks are skipped');
assert.equal(b.words.length, 9);
assert(b.sentences[0].heading && !b.sentences[1].heading);

// chunks never cross a sentence or a comma
const ch = R.rsvpChunks(b.words, 3);
assert(ch.every((c) => b.words[c.from].s === b.words[c.to].s), 'chunk stays inside one sentence');
assert(ch.some((c) => c.text === 'First sentence,'), 'a comma ends the chunk: ' + ch.map((c) => c.text));
assert.equal(R.rsvpChunks(b.words, 1).length, b.words.length);

// pacing: base 200 ms at 300 WPM, longer at punctuation, slower ramp at the start, clamped range
assert.equal(R.rsvpDelayMs('word', 300, { index: 20 }), 200);
assert.equal(R.rsvpDelayMs('end.', 300, { index: 20 }), 400);
assert.equal(R.rsvpDelayMs('pause,', 300, { index: 20 }), 300);
assert(R.rsvpDelayMs('word', 300, { index: 0 }) > 200, 'first words are slower');
assert.equal(R.rsvpClampWpm(5000), R.RSVP_MAX_WPM); assert.equal(R.rsvpClampWpm(10), R.RSVP_MIN_WPM); assert.equal(R.rsvpClampWpm('x'), R.RSVP_DEFAULT_WPM);

// pivot letter about a third in, after leading punctuation
assert.equal(R.rsvpPivot('a'), 0); assert.equal(R.rsvpPivot('word'), 1); assert.equal(R.rsvpPivot('„Hallo'), 2); assert.equal(R.rsvpPivot('recognition'), 3);

// back one sentence: from the middle of a sentence first to its start
const one = R.rsvpChunks(b.words, 1);
assert.equal(R.rsvpSentenceStart(one, 4, -1), 2, 'middle of sentence 2 → its start');
assert.equal(R.rsvpSentenceStart(one, 2, -1), 0, 'start of a sentence → the one before');
assert.equal(R.rsvpSentenceStart(one, 2, 1), 7, 'forward one sentence');
assert(R.rsvpSecondsLeft(one, 0, 300, b.sentences) > 0);

// reminder time: local wall clock, fixed hour
const wed = new Date(2026, 10, 11, 21, 30).getTime();   // Wednesday 21:30
const at = (t) => new Date(t);
let t = at(D.decisionDueAt('tomorrow', wed)); assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [12, 8, 0]);
t = at(D.decisionDueAt('weekend', wed, '09:15')); assert.deepEqual([t.getDay(), t.getDate(), t.getHours(), t.getMinutes()], [6, 14, 9, 15], 'next Saturday');
t = at(D.decisionDueAt('weekend', new Date(2026, 10, 14, 10).getTime())); assert.equal(t.getDay(), 0, 'on a Saturday: Sunday');
t = at(D.decisionDueAt('week', wed)); assert.deepEqual([t.getDay(), t.getDate()], [1, 16], 'next Monday');
t = at(D.decisionDueAt('week', new Date(2026, 10, 16, 7).getTime())); assert.equal(t.getDate(), 23, 'on a Monday: the Monday after');
assert.equal(D.decisionDueAt('none', wed), null); assert.equal(D.decisionDueAt('research', wed), null);
t = at(D.decisionDueAt('tomorrow', wed, 'bogus')); assert.equal(t.getHours(), 8, 'bad time → 08:00');
console.log('TEST 254 OK'); process.exit(0);
