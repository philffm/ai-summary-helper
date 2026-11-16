// Quiz across articles (Figma AISH-040): plan, answer shuffle, quote check, generation with a fake model (per article + across),
// and the exports (Kahoot .xlsx rows + parts, Anki, Moodle GIFT).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const G = await imp('modules/quiz/quizGen.js');
const X = await imp('modules/quiz/quizExport.js');

// plan: both = about a quarter across, the rest spread over the articles; one article = no across
assert.deepEqual(G.quizPlan(10, 4, 'both'), { per: [2, 2, 2, 1], across: 3 });
assert.deepEqual(G.quizPlan(10, 4, 'article'), { per: [3, 3, 2, 2], across: 0 });
assert.deepEqual(G.quizPlan(5, 3, 'across'), { per: [0, 0, 0], across: 5 });
assert.deepEqual(G.quizPlan(5, 1, 'both'), { per: [5], across: 0 });

// shuffle keeps the right answer and is stable
const sh = G.shuffleAnswers(['right', 'b', 'c', 'd'], 0, 'Why?');
assert.equal(sh.options[sh.correct], 'right'); assert.deepEqual(G.shuffleAnswers(['right', 'b', 'c', 'd'], 0, 'Why?'), sh);
assert.ok(['A?', 'B?', 'C?', 'D?', 'E?', 'F?'].some(k => G.shuffleAnswers(['r', 'b', 'c', 'd'], 0, k).correct !== 0), 'the right answer is not always first');

// paragraphs + ¶
const art = (id, title, paras) => ({ id, title, content: paras.map(p => `<p>${p}</p>`).join('') });
const A = art('a', 'Oceans', ['Intro line here.', 'Water takes up heat slowly and gives it back just as slowly, long after the sun has set.', 'Oceans cover most of the planet.']);
const B = art('b', 'Heat islands', ['Cities are warmer.', 'Concrete and asphalt store the day’s heat and release it through the night.', 'Trees help.']);
assert.equal(G.paragraphOf(G.articleParagraphs(A), 'water takes up heat slowly'), 2);
assert.equal(G.paragraphOf(G.articleParagraphs(B), 'Concrete and asphalt store the day\'s heat'), 2, 'curly and straight apostrophes match');

// quote check: shape, duplicates, quote not in the text
const find = (q) => (G.normQuote(G.articleParagraphs(A).join(' ')).includes(G.normQuote(q)) ? { articleId: 'a', para: 2 } : null);
assert.ok(G.checkQuestion({ q: 'When does water give heat back?', options: ['Slowly, after sunset', 'Never', 'At noon', 'Only in winter'], correct: 0, quote: 'gives it back just as slowly, long after the sun has set' }, find).question);
assert.equal(G.checkQuestion({ q: 'When does water give heat back?', options: ['x', 'y', 'z', 'w'], correct: 0, quote: 'this sentence is not in the article at all' }, find).drop, 'source');
assert.equal(G.checkQuestion({ q: 'Short?', options: ['x', 'x', 'z', 'w'], correct: 0, quote: 'gives it back just as slowly' }, find).drop, 'shape');
assert.equal(G.checkQuestion({ q: 'When does water give heat back?', options: ['x', 'y', 'z'], correct: 0, quote: 'gives it back just as slowly' }, find).drop, 'shape');
assert.equal(G.parseJsonReply('Sure!\n```json\n{"questions":[]}\n```').questions.length, 0);
assert.equal(G.parseJsonReply('no json'), null);

// generation with a fake model: one invented quote per article is dropped; across uses fact ids from two articles
const calls = [];
const fake = async (system, user) => {
  calls.push({ system, user });
  if (/connect two different articles/.test(system)) {
    const ids = [...user.matchAll(/^([A-Z]\d) \(article (\d)/gm)].map(m => ({ id: m[1], art: m[2] }));
    const a = ids.find(x => x.art === '1'), b = ids.find(x => x.art === '2');
    return JSON.stringify({ questions: [
      { q: 'What do both articles name as the reason places stay warm at night?', options: ['Wind', 'Stored heat released slowly', 'Clouds', 'Pollution'], correct: 1, facts: [a.id, b.id] },
      { q: 'This one cites only one article, so it must be dropped?', options: ['a', 'b', 'c', 'd'], correct: 0, facts: [a.id] },
    ] });
  }
  const isA = /Oceans/.test(user);
  const good = isA ? 'Water takes up heat slowly and gives it back just as slowly' : 'Concrete and asphalt store the day’s heat';
  return JSON.stringify({ questions: [
    { q: isA ? 'How does water give back heat?' : 'What do concrete and asphalt do?', options: isA ? ['Slowly', 'Quickly', 'Never', 'Only at noon'] : ['Store heat', 'Reflect all light', 'Cool the air', 'Nothing'], correct: 0, quote: good },
    { q: isA ? 'An invented question about oceans?' : 'An invented question about cities?', options: ['1', '2', '3', '4'], correct: 2, quote: 'A sentence the article never says, made up by the model.' },
    { q: isA ? 'What covers most of the planet?' : 'What helps against heat in cities?', options: isA ? ['Oceans', 'Forests', 'Deserts', 'Ice'] : ['Trees', 'Cars', 'Glass', 'Asphalt'], correct: 0, quote: isA ? 'Oceans cover most of the planet.' : 'Trees help.' },
  ], facts: [good, 'A made-up fact that is not in the text.'] });
};
const seen = [];
const res = await G.createQuiz([A, B], { total: 4, mix: 'both', lang: 'English', aiComplete: fake, onArticle: (s) => seen.push(s.state), onAcross: (s) => seen.push('across:' + s.state) });
assert.equal(res.requests, 3, 'one request per article + one across');
assert.ok(/Write 3 questions/.test(calls[0].user) && /Write the questions and answers in English/.test(calls[0].system));
assert.equal(res.questions.length, 4);
assert.ok(res.questions.every(q => q.sources.length && q.options.length === 4 && q.options[q.correct]));
const across = res.questions.filter(q => q.kind === 'across');
assert.equal(across.length, 1, 'the one-article "across" question is dropped');
assert.deepEqual([...new Set(across[0].sources.map(s => s.articleId))].sort(), ['a', 'b'], 'cites both articles');
assert.ok(across[0].sources.every(s => s.para === 2), 'with the paragraph');
assert.ok(res.perArticle.every(p => p.dropped >= 1), 'invented quotes are counted as dropped');
assert.ok(!res.questions.some(q => /invented/i.test(q.q)), 'no question without a real quote');
assert.deepEqual(seen.filter(s => s === 'done').length, 2); assert.ok(seen.includes('across:done'));
// a failing model: no questions, no throw
const empty = await G.createQuiz([A, B], { total: 4, aiComplete: async () => 'I cannot do that.', onArticle() {}, onAcross() {} });
assert.equal(empty.questions.length, 0);
// cancel
const ac = new AbortController(); ac.abort();
await assert.rejects(G.createQuiz([A, B], { total: 4, aiComplete: fake, signal: ac.signal }), (e) => e.name === 'AbortError');

// exports
const quiz = { name: 'Climate: 10b', articles: [{ id: 'a', title: 'Oceans' }, { id: 'b', title: 'Heat islands' }], questions: [
  ...res.questions,
  { id: 'qlong', q: 'Q'.repeat(10) + ' ' + 'word '.repeat(40), options: ['short', 'x'.repeat(30) + ' ' + 'y '.repeat(40), 'c', 'd'], correct: 1, sources: [{ articleId: 'a', quote: 'Oceans cover most', para: 3 }] },
] };
const { rows, cut } = X.kahootRows(quiz, 30);
assert.deepEqual(rows[0], ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Time limit', 'Correct answer(s)']);
assert.equal(rows.length, quiz.questions.length + 1);
assert.ok(rows.slice(1).every(r => r[0].length <= 120 && r.slice(1, 5).every(a => a.length <= 75) && r[5] === 30 && r[6] >= 1 && r[6] <= 4));
assert.equal(rows.at(-1)[6], 2, 'correct answer as 1-based number');
assert.equal(cut, 2, 'question and one answer shortened'); assert.ok(rows.at(-1)[0].endsWith('…'));
assert.equal(X.kahootRows(quiz, 45).rows[1][5], 20, 'unknown time → 20 s');
const parts = X.xlsxParts(rows, 'Kahoot');
assert.deepEqual(parts.map(p => p.name), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
const sheet = parts[4].text, sst = parts[5].text;
assert.ok(/<c r="F2"><v>30<\/v><\/c>/.test(sheet) && /<c r="A1" t="s"><v>0<\/v><\/c>/.test(sheet), 'numbers as numbers, text as shared strings');
assert.ok(sst.includes('<t xml:space="preserve">Question</t>') && !/<t[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;)/.test(sst), 'escaped');
for (const p of parts) new (globalThis.window.DOMParser)().parseFromString(p.text, 'application/xml').querySelector('parsererror') && assert.fail(p.name + ' is not well-formed XML');
const { blob } = await X.kahootXlsx(quiz, 20);
assert.ok(blob.size > 500 && /spreadsheetml/.test(blob.type));
const anki = X.ankiText(quiz);
assert.ok(anki.startsWith('#separator:tab') && /#deck:AI Summary Helper::Climate: 10b/.test(anki) && anki.split('\n').filter(l => l.startsWith('aishquiz_')).length === quiz.questions.length);
assert.ok(/Oceans ¶ 3/.test(anki), 'the source on the back');
const gift = X.moodleGift(quiz);
assert.ok(gift.includes('::Climate\\: 10b 1::'), 'colons in names escaped');
assert.equal((gift.match(/^\t=/gm) || []).length, quiz.questions.length, 'one right answer per question');
assert.equal((gift.match(/^\t~/gm) || []).length, quiz.questions.length * 3);
assert.ok(/\t####“/.test(gift), 'source as general feedback');
console.log('TEST 260 OK'); process.exit(0);
