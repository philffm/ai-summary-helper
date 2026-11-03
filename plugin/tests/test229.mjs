// Name tags with AI from the graph: only tag words are sent, a local model when there is one, a preview before anything is saved,
// the rest in batches that a stop keeps, and the graph redraws with the merged topics.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
import path from 'path'; import { pathToFileURL } from 'url';
// one instance of each module, the same the page uses (imp() adds a cache-buster, which would load a second, separate lexicon)
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);
const gn = await load('modules/graphTagNaming.js');
const tc = await load('modules/topicConcepts.js');
const ai = await load('modules/feedAi.js');

// ── which tags ──
tc.setLexicon({});
const articles = [
    { id: 'a', title: 'Secret title about my project', summary: 'private text', tags: ['Technology', 'KI-Regulierung', '🌐 de', 'General'] },
    { id: 'b', title: 'Other', tags: ['AI regulation', 'Chipfertigung', 'News'] },
    ...Array.from({ length: 50 }, (_, i) => ({ id: 'x' + i, title: 'x', tags: ['Topic ' + i] }))
];
const todo = gn.tagsToName(articles);
assert.ok(!todo.some(t => /^(Technology|General|🌐 de)$/.test(t)), 'no categories, no "General", no language marks: ' + todo.slice(0, 5));
assert.ok(!todo.includes('News'), 'built-in topics already have a name');
assert.ok(todo.includes('KI-Regulierung') && todo.includes('Chipfertigung'));
assert.equal(todo.length, 53);

// ── where it goes ──
assert.deepEqual(await gn.namingRoute(async () => ({ sync: { connectionMode: 'local', activeService: 'custom' }, services: {} })).then(r => [r.service, r.local]), ['', true], 'a local connection is used as it is');
assert.deepEqual(await gn.namingRoute(async () => ({ sync: { connectionMode: 'cloud' }, services: { ollama: { endpoint: 'http://localhost:11434' } } })).then(r => [r.service, r.local]), ['ollama', true], 'Ollama when it is set up, even if summaries use the cloud');
assert.deepEqual(await gn.namingRoute(async () => ({ sync: { connectionMode: 'cloud' }, services: {} })).then(r => [r.service, r.local]), ['', false], 'otherwise the connection used for summaries');

// ── the page: try → preview (nothing saved) → save and name the rest ──
const sent = [];
ai.setAiTransport(async ({ user, service }) => {
    sent.push({ user, service });
    const lines = user.split('\n');
    return lines.map((l, k) => { const t = l.replace(/^\[\d+\]\s*/, ''); return `${k + 1}:${t === 'KI-Regulierung' ? 'AI regulation' : t.replace(/^Topic /, 'subject ')}${t === 'Chipfertigung' ? ' = Chipfertigung' : ''}`; }).join(' | ');
});
const box = d.createElement('div'); d.body.append(box);
let saves = 0, doneWith = null;
const deps = { ai, route: { service: 'ollama', local: true, label: 'your local model (Ollama)' }, saveLexicon: async () => { saves++; } };
await gn.openTagNamingPage(box, { articles, onDone: (n) => { doneWith = n; } }, deps);
const page = box.querySelector('.graph-naming-page');
assert.ok(page, 'the page opens over the graph');
assert.ok(/53 tags have no English name/.test(page.textContent) && /Only the tag words are sent/.test(page.textContent) && /Ollama/.test(page.textContent), 'it says how many, what is sent and where');
page.querySelector('.graph-naming-try').click();
for (let i = 0; i < 50 && !page.querySelector('.graph-naming-row'); i++) await tick(5);
assert.equal(page.querySelectorAll('.graph-naming-row').length, 40, 'a preview of the first 40; page says: ' + page.querySelector('.graph-cluster-answer').textContent);
assert.equal(sent.length, 1); assert.equal(sent[0].service, 'ollama', 'to the local model');
assert.ok(!/Secret title|private text|my project/.test(sent[0].user), 'no article text, no titles: only the tag words');
assert.equal(saves, 0, 'nothing is saved by the preview');
assert.notEqual(tc.conceptKey('KI-Regulierung'), tc.conceptKey('AI regulation'), 'and nothing is learned yet');
const saveAll = page.querySelector('.graph-naming-save-all');
assert.ok(!saveAll.hidden && /other 13/.test(saveAll.textContent), 'offers to save and name the other 13');
saveAll.click();
for (let i = 0; i < 100 && doneWith === null; i++) await tick(5);
assert.equal(doneWith, 53, 'all named; the graph is told to redraw');
assert.equal(sent.length, 2, 'the rest went as one more batch');
assert.equal(saves, 2, 'saved after the first batch and after each further one');
assert.equal(tc.conceptKey('KI-Regulierung'), tc.conceptKey('AI regulation'), 'now one topic across languages');
assert.equal(tc.topicLabel('Chipfertigung', 'en'), 'Chipfertigung', 'the English label (here the model kept the word)');

// ── stopping half way keeps what is done ──
tc.setLexicon({});
let calls = 0, ctlSeen = null;
ai.setAiTransport(async ({ user, signal }) => {
    calls++; ctlSeen = signal;
    if (calls === 2) await new Promise((res, rej) => { signal.addEventListener('abort', () => rej(Object.assign(new Error('Cancelled'), { name: 'AbortError', cancelled: true }))); });
    return user.split('\n').map((l, k) => `${k + 1}:${l.replace(/^\[\d+\]\s*/, '')}`).join(' | ');
});
const many = Array.from({ length: 130 }, (_, i) => ({ id: 'm' + i, tags: ['Thing ' + i] }));
const box2 = d.createElement('div'); d.body.append(box2);
let done2 = null, saves2 = 0;
await gn.openTagNamingPage(box2, { articles: many, onDone: (n) => { done2 = n; } }, { ...deps, saveLexicon: async () => { saves2++; } });
const p2 = box2.querySelector('.graph-naming-page');
p2.querySelector('.graph-naming-try').click();
for (let i = 0; i < 50 && !p2.querySelector('.graph-naming-row'); i++) await tick(5);
p2.querySelector('.graph-naming-save-all').click();
for (let i = 0; i < 50 && calls < 2; i++) await tick(5);
const stop = p2.querySelector('.graph-naming-stop');
assert.ok(!stop.hidden, 'a Stop button while it runs');
stop.click();
for (let i = 0; i < 100 && done2 === null; i++) await tick(5);
assert.equal(done2, 40, 'the first batch stays named');
assert.ok(/40 of 130 tags named and saved before it stopped/.test(p2.textContent), 'and it says so: ' + p2.querySelector('.graph-cluster-answer').textContent);
assert.equal(saves2, 1);

// ── nothing to do / a failing model ──
const box3 = d.createElement('div'); d.body.append(box3);
await gn.openTagNamingPage(box3, { articles: [{ id: 'k', tags: ['News', '🌐 en'] }] }, deps);
assert.ok(/Every tag already has a name/.test(box3.textContent) && box3.querySelector('.graph-naming-try').hidden);
ai.setAiTransport(async () => 'I cannot do that.');
const box4 = d.createElement('div'); d.body.append(box4);
await gn.openTagNamingPage(box4, { articles: [{ id: 'z', tags: ['Unheard'] }] }, deps);
box4.querySelector('.graph-naming-try').click();
for (let i = 0; i < 50 && !/could not be read/.test(box4.textContent); i++) await tick(5);
assert.ok(/could not be read/.test(box4.textContent) && !box4.querySelector('.graph-naming-try').disabled, 'an unreadable reply is said, and you can try again');
ai.setAiTransport(null);
console.log('tag naming ok');
