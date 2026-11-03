// "Translated" into the same language: a German tag named "Wohnkosten" again, or an English one given the English word as its German
// name. The tag's language is sent with it, a tag in the UI language keeps itself as its UI name, the rest is asked once more, and what
// stays the same is taken as a name and marked. Names learned earlier can be tidied up (duplicates merged, untranslated ones forgotten
// to be named again) or all forgotten. The topic briefing shows the live status card while it runs.
import { setup, tick } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const { w } = setup({});
await chrome.storage.sync.set({ uiLanguage: 'de' });   // a German UI
const d = w.document;
globalThis.document = d; globalThis.window = w;
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);
const tc = await load('modules/topicConcepts.js');
const ai = await load('modules/feedAi.js');
const gn = await load('modules/graphTagNaming.js');
const le = await load('modules/lexiconEditor.js');
const wait = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await tick(5); };

// ── languages of the tags ──
const arts = [
    { id: 'a', tags: ['Wohnkosten', 'Nasdaq', 'Berliner Wohnungsmarkt', '🌐 de'] },
    { id: 'b', tags: ['cancer prevention', 'Georgia', '🌐 de', '🌐 en'] },
    { id: 'c', tags: ['Wohnkosten', '🌐 de'] }
];
const langs = gn.tagLanguagesOf(arts);
assert.equal(langs.get('Wohnkosten'), 'de'); assert.equal(langs.get('cancer prevention'), 'en', 'the last mark is the summary language');
assert.equal(ai.languageOfCode('de'), 'German'); assert.equal(ai.languageOfCode('pt_BR'), 'Brazilian Portuguese');

// ── naming: hint, own UI word, one follow-up each way ──
tc.setLexicon({});
const seen = [];
ai.setAiTransport(async ({ system, user }) => {
    seen.push({ system, user });
    if (/^Translate each numbered topic tag into English/.test(system)) return '1:Housing costs | 2:Nasdaq';   // the follow-up: Nasdaq is a name
    if (/^Write each numbered English topic in German/.test(system)) return '1:Krebsvorsorge (German) | 2:Georgia';
    // the first answer: German tags repeated, English UI words left English
    return '1:Wohnkosten = Wohnkosten | 2:Nasdaq = Nasdaq | 3:Berlin housing market = Berliner Wohnungsmarkt | 4:Cancer prevention = cancer prevention | 5:Georgia = Georgia';
});
const tags = ['Wohnkosten', 'Nasdaq', 'Berliner Wohnungsmarkt', 'cancer prevention', 'Georgia'];
const r = await ai.nameTags(tags, { langs, english: gn.englishTagsOf(arts) });
assert.ok(/\[1\] Wohnkosten \(German\)/.test(seen[0].user) && /\[4\] Cancer Prevention \(English\)|\[4\] cancer prevention \(English\)/.test(seen[0].user), 'each tag goes with its language: ' + seen[0].user);
assert.ok(/its English name is its English translation/.test(seen[0].system));
assert.equal(seen.length, 3, 'one follow-up for the English names, one for the German ones');
assert.ok(/Wohnkosten \(German\)/.test(seen[1].user) && /Nasdaq/.test(seen[1].user) && !/Berliner/.test(seen[1].user), 'only the repeated ones are asked again: ' + seen[1].user);
const by = Object.fromEntries(tags.map((t, k) => [t, r.names[k]]));
assert.equal(by.Wohnkosten.en, 'housing costs', 'translated on the second try');
assert.equal(by.Wohnkosten.ui, 'Wohnkosten', 'a German tag is its own German name');
assert.equal(by.Nasdaq.en, 'nasdaq'); assert.equal(by.Nasdaq.same, 'en', 'unchanged twice: a name, marked');
assert.equal(by['Berliner Wohnungsmarkt'].en, 'berlin housing market'); assert.ok(!by['Berliner Wohnungsmarkt'].same);
assert.equal(by['cancer prevention'].ui, 'Krebsvorsorge', 'the German word, as written, without the echoed "(German)"');
assert.equal(by.Georgia.ui, 'Georgia'); assert.equal(by.Georgia.same, 'ui');
ai.applyTagNames(tags, r.names, r.code);
assert.ok(tc.isMarkedName('nasdaq'), 'a name is remembered as one');
ai.setAiTransport(null);

// ── tidy up what was learned before ──
tc.setLexicon({
    'covert influence operati': { en: 'Covert influence operati', '*': ['Verdeckte Operationen'] },
    'covert influence operations': { en: 'Covert influence operations', '*': ['covert ops'] },
    'habit': { en: 'Habit', '*': ['habit'] }, 'habits': { en: 'Habits', '*': ['habits', 'Gewohnheiten'] },
    'user-centered design': { en: 'User-centered design', '*': ['user-centered design'] }, 'user centered design': { en: 'User centered design', '*': ['UCD'] },
    'wohnkosten': { en: 'Wohnkosten', '*': ['Wohnkosten'] },
    'nasdaq': { en: 'Nasdaq', '*': ['Nasdaq'], '!': true },
    'housing market': { en: 'Housing market', '*': ['Wohnungsmarkt'] }
});
const plan = le.tidyPlan(new Map([['Wohnkosten', 'de'], ['Nasdaq', 'de'], ['Wohnungsmarkt', 'de']]));
assert.deepEqual(plan.duplicates.map(p => p.join('→')).sort(), ['covert influence operati→covert influence operations', 'habit→habits', 'user centered design→user-centered design'].sort(), JSON.stringify(plan.duplicates));
assert.deepEqual(plan.untranslated, ['wohnkosten'], 'Nasdaq was checked as a name; Wohnungsmarkt is translated');
const res = le.tidyLexicon(new Map([['Wohnkosten', 'de'], ['Nasdaq', 'de']]));
assert.deepEqual(res, { merged: 3, reasked: 1 });
assert.equal(tc.conceptKey('Verdeckte Operationen'), tc.conceptKey('covert ops'));
assert.equal(tc.conceptKey('habit'), tc.conceptKey('Gewohnheiten'));
assert.equal(tc.conceptKey('UCD'), tc.conceptKey('user-centered design'));
assert.deepEqual(gn.tagsToName([{ tags: ['Wohnkosten', 'Nasdaq'] }]), ['Wohnkosten'], 'the untranslated one is named again');
assert.equal(le.resetLexicon(), 5); assert.deepEqual(tc.getLexicon(), {});

// the settings list: tidy and forget all
tc.setLexicon({ 'habit': { en: 'Habit' }, 'habits': { en: 'Habits', '*': ['a', 'b'] } });
const box = d.createElement('div'); d.body.append(box);
let saves = 0;
le.mountLexiconEditor(box, { save: async () => { saves++; }, confirm: async () => true });
box.querySelector('.lexicon-tidy').click(); await wait(() => saves === 1);
assert.ok(/1 merged, 0 forgotten/.test(box.querySelector('.lexicon-said').textContent));
box.querySelector('.lexicon-reset').click(); await wait(() => saves === 2);
assert.deepEqual(tc.getLexicon(), {}); assert.ok(/No learned names yet/.test(box.textContent));

// the naming page offers the tidy-up
tc.setLexicon({ 'habit': { en: 'Habit' }, 'habits': { en: 'Habits', '*': ['a', 'b'] } });
const box2 = d.createElement('div'); d.body.append(box2);
let redraws = [];
await gn.openTagNamingPage(box2, { articles: [{ id: 'x', tags: ['habit', 'Neu'] }], onDone: (n) => redraws.push(n) }, { ai, route: { service: '', local: true, label: 'local' }, saveLexicon: async () => {}, mountPage: (c, p) => { c.textContent = ''; c.append(p); return () => p.remove(); } });
assert.ok(/1 learned name is a duplicate/.test(box2.textContent), box2.textContent.slice(0, 300));
box2.querySelector('.graph-naming-tidy-btn').click();
await wait(() => redraws.length && box2.querySelector('.graph-naming-tidy') && box2.querySelector('.graph-naming-tidy').hidden);
assert.ok(box2.querySelector('.graph-naming-tidy').hidden, 'reopened, nothing left to tidy');
assert.deepEqual(redraws, [0]);

// ── the briefing shows the live status ──
const gc = await load('modules/graphClusters.js');
let release;
ai.setAiTransport(({ onStage }) => { if (onStage) onStage('wait'); return new Promise(res => { release = () => res('A short briefing [1].'); }); });
const box3 = d.createElement('div'); d.body.append(box3);
gc.openClusterPage(box3, { label: 'Housing', articles: [{ id: 'h1', title: 'Rents', summary: 'Rents went up.', timestamp: '2026-01-01' }, { id: 'h2', title: 'Owners', summary: 'Fewer owners.', timestamp: '2026-02-01' }] });
box3.querySelector('.graph-cluster-brief').click();
await wait(() => box3.querySelector('.recap-status') && release);
const card = box3.querySelector('.recap-status');
assert.ok(card, 'a status card while it runs');
assert.ok(/Briefing from 2 summaries/.test(card.textContent) && /Waiting for the model/.test(card.textContent) && card.querySelector('.recap-cancel'), card.textContent);
release();
await wait(() => box3.querySelector('.graph-cluster-answer-meta'));
assert.ok(!box3.querySelector('.recap-status'), 'replaced by the answer');
assert.ok(/from 2 summaries/.test(box3.querySelector('.graph-cluster-answer-meta').textContent));
// Cancel stops it
ai.setAiTransport(({ signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('Cancelled'), { name: 'AbortError', cancelled: true })))));
box3.querySelector('.graph-cluster-brief').click();
await wait(() => box3.querySelector('.recap-cancel'));
box3.querySelector('.recap-cancel').click();
await wait(() => /Stopped/.test(box3.querySelector('.graph-cluster-answer').textContent));
assert.ok(/Stopped/.test(box3.querySelector('.graph-cluster-answer').textContent));
ai.setAiTransport(null);
console.log('same-language names, tidy-up and briefing status ok');
