// The questions prepared with a summary are kept when it is saved, also with no side panel open to offer them.
import assert from 'assert';
const data = {};
globalThis.chrome = { storage: { local: { get: (q, cb) => cb({ ...q, ...data }), set: (v, cb) => { Object.assign(data, structuredClone(v)); cb(); } } }, runtime: {} };
const { saveToLocalStorage } = await import('../src/content/core.js');
const save = (followUps) => saveToLocalStorage('<p>c</p>', '<p>s</p>', 'https://example.org/a', 'T', '', [], 'm', 200, undefined, {}, {}, followUps);
const first = await save({ questions: ['Why so?', 'And then?'], quick: { 'Why so?': 'Because of it.', 'Gone?': 'x' } });
const rec = data['articles:rec:' + first.id];
assert.deepEqual(rec.suggested, ['Why so?', 'And then?']);
assert.deepEqual(rec.suggestedAnswers, { 'Why so?': 'Because of it.' });
assert.ok(!('suggested' in data['articles:index'][0]), 'the list stays lean');
for (const none of [undefined, { questions: [], quick: {} }]) {
    const next = await save(none);
    assert.ok(!('suggested' in data['articles:rec:' + next.id]));
}
console.log('ok: prepared questions saved');
process.exit(0);
