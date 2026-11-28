// Questions in Notes: only those saved to the notes are listed, only articles that were asked something are read, the toggle under an
// answer sets the mark apart from "In article", and "Remove from notes" leaves the question with its article.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const V = await imp('modules/notesView.js');
const Q = await imp('modules/qaView.js');
const C = await imp('modules/conversation.js');
const { articleRecKey } = await imp('modules/storageKeys.js');

const articles = [
    { id: 'a1', url: 'https://sleep.example/memory', title: 'How sleep consolidates memory', qaCount: 2 },
    { id: 'a2', url: 'https://other.example/x', title: 'Never asked' },
    { id: 'a3', url: 'https://third.example/y', title: 'Asked, nothing saved', qaCount: 1 },
];
const records = {
    [articleRecKey('a1')]: { content: 'long text', conversation: [
        { id: 'q1', q: 'Why does sleep help?', a: 'It **replays** the day.', pinned: false, noted: true, ts: '2026-11-02T08:40:00Z' },
        { id: 'q2', q: 'Pinned, not saved', a: 'x', pinned: true, ts: '2026-11-02T08:41:00Z' },
    ] },
    [articleRecKey('a3')]: { conversation: [{ id: 'q3', q: 'Another', a: 'y', ts: '2026-11-02T08:42:00Z' }] },
};
const asked = [];
const read = async (keys) => { asked.push(...keys); return Object.fromEntries(keys.filter((k) => records[k]).map((k) => [k, records[k]])); };
const questions = await V.savedQuestions(articles, read);
assert.deepEqual(questions.map((q) => q.id), ['q1'], 'a pinned question is not a saved one');
assert.deepEqual(asked, [articleRecKey('a1'), articleRecKey('a3')], 'an article nobody asked about is not read');
asked.length = 0;
assert.deepEqual(await V.savedQuestions(articles, read, 'a3'), []);
assert.deepEqual(asked, [articleRecKey('a3')], 'one article: only its record');

const stream = V.buildStream({ notes: [{ id: 'n1', text: 'A note', tags: [], created: '2026-11-02T09:00:00Z' }], comments: {}, highlights: [
    { id: 'h1', url: 'https://sleep.example/memory', text: 'marked', type: 'user', timestamp: '2026-11-02T08:00:00Z' }], articles, questions });
assert.deepEqual(stream.map((i) => [i.kind, i.id]), [['note', 'n1'], ['qa', 'q1'], ['user', 'h1']]);
assert.equal(stream[1].source.title, 'How sleep consolidates memory');
assert.deepEqual(V.filterStream(stream, { filter: 'notes' }).map((i) => i.id), ['n1', 'q1'], 'questions stand with the notes');
assert.deepEqual(V.filterStream(stream, { filter: 'mine' }).map((i) => i.id), ['h1']);
assert.deepEqual(V.filterStream(stream, { q: 'replays' }).map((i) => i.id), ['q1'], 'the answer is searched too');
assert.equal(V.groupByArticle(stream).find((r) => r.key === 'a1').notes, 1);

// the toggle under an answer
const turn = C.newTurn([], { q: 'First?', a: 'Yes.' });
assert.ok(turn.pinned && !turn.noted, 'the first question is pinned, never saved to the notes by itself');
let saves = 0;
const el = Q.turnEl(turn, { onPin: () => saves++ });
const button = el.querySelector('.chat-note');
assert.equal(button.getAttribute('aria-pressed'), 'false');
button.click();
assert.equal(turn.noted, true); assert.equal(turn.pinned, true, 'the pin stays as it was');
assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.equal(saves, 1);
button.click();
assert.ok(!('noted' in turn)); assert.equal(saves, 2);
console.log('ok: questions in notes');
process.exit(0);
