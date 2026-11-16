// Quiz from the full text (AISH-040 follow-up): quotes only have to be close (the article's own sentence is shown), a missing quote
// falls back to the sentence that supports the answer, long articles are sent as paragraphs spread over the whole text, and the prompt
// asks for comprehension questions.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const G = await imp('modules/quiz/quizGen.js');

const paras = [
  'Sleep is not a pause for the brain.',
  'During slow-wave sleep, the brain replays the day’s experiences, which strengthens the connections between neurons. This is why a night of sleep helps learning.',
  'Short naps of about twenty minutes improve recall; longer naps add little and can leave people groggy.',
  'Screens before bed delay sleep more than caffeine after noon, the researchers found.',
];
const sents = G.articleSentences(paras);
assert.ok(sents.length >= 5 && sents.every(s => s.p >= 1 && s.text));

// exact, with other quote marks / spacing
let r = G.locateQuote(sents, 'During slow-wave sleep, the brain replays the day\'s experiences');
assert.ok(r && r.exact && r.p === 2 && r.quote.startsWith('During slow-wave sleep'), 'exact');
// close: punctuation and one word changed → the article's own sentence is shown
r = G.locateQuote(sents, 'during slow wave sleep the brain replays the days experiences which strengthens connections between nerve cells');
assert.ok(r && !r.exact && r.p === 2, 'close quote found'); assert.ok(r.quote.includes('neurons'), 'the article wording, not the model’s');
// with an ellipsis
r = G.locateQuote(sents, 'Short naps of about twenty minutes improve recall … can leave people groggy');
assert.ok(r && r.p === 3, 'quote with …');
// spanning two sentences of one paragraph
r = G.locateQuote(sents, 'which strengthens the connections between neurons. This is why a night of sleep helps learning');
assert.ok(r && r.p === 2 && r.quote.includes('helps learning'));
// not there
assert.equal(G.locateQuote(sents, 'Coffee in the morning is the main cause of poor sleep in teenagers'), null);
assert.equal(G.locateQuote(sents, 'too short'), null);

// support fallback: no quote, but the answer is in the text
const s = G.supportingSentence(sents, 'What delays sleep the most, according to the researchers?', 'Screens before bed');
assert.ok(s && s.p === 4, 'supporting sentence for the answer');
assert.equal(G.supportingSentence(sents, 'Which colour is the sky?', 'Bright purple banana'), null, 'nothing supports a made-up answer');
assert.equal(G.supportingSentence(sents, 'How many?', '1'), null, 'a lone digit is not support');

// checkQuestion: a near quote is kept and replaced by the article's sentence; no quote → support; unsupported → dropped
const find = (q) => { const x = G.locateQuote(sents, q); return x ? { articleId: 'a', para: x.p, quote: x.quote } : null; };
const support = (q, a) => { const x = G.supportingSentence(sents, q, a); return x ? { articleId: 'a', para: x.p, quote: x.quote } : null; };
const base = { q: 'Why does a night of sleep help learning?', options: ['The brain replays the day and strengthens connections', 'The body rests its muscles', 'Dreams invent new memories', 'Sleep removes old memories'], correct: 0 };
let c = G.checkQuestion({ ...base, quote: 'the brain replays the days experiences which strengthens the connections between neurons' }, find, support);
assert.ok(c.question && c.question.sources[0].quote.includes('slow-wave'), 'near quote → real sentence');
c = G.checkQuestion({ ...base, quote: 'A sentence nobody wrote anywhere at all in this text.' }, find, support);
assert.ok(c.question && c.question.sources[0].para === 2, 'bad quote, but the answer is supported');
c = G.checkQuestion({ ...base, options: ['Because of the moon', 'b option', 'c option', 'd option'], quote: '' }, find, support);
assert.equal(c.drop, 'source', 'nothing in the text supports it');

// full text: short articles go in whole; long ones as paragraphs spread over the whole article, with […]
const short = G.articleText(paras, 24000);
assert.equal(short.partial, false); assert.ok(short.text.includes('researchers found'));
const many = Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}: ` + 'some words about the topic '.repeat(8));
const long = G.articleText(many, 6000);
assert.equal(long.partial, true); assert.ok(long.text.length <= 6000 + 400);
const kept = [...long.text.matchAll(/Paragraph (\d+):/g)].map(m => Number(m[1]));
assert.ok(kept[0] <= 3 && kept.at(-1) >= 180 && kept.some(n => n > 80 && n < 120), 'beginning, middle and end: ' + kept.join(','));
assert.ok(long.text.includes('[…]'));

// prompt: comprehension, whole text, no trivia; mentions the selection when partial
const pr = G.articlePrompt({ title: 'Sleep', text: long.text, n: 3, lang: 'German', partial: true });
assert.ok(/UNDERSTOOD/.test(pr.system) && /reasons and causes/.test(pr.system) && /whole text/.test(pr.system) && /Avoid trivia/.test(pr.system));
assert.ok(/in German/.test(pr.system) && /selection of paragraphs/.test(pr.system) && /Write 4 questions/.test(pr.user));

// createQuiz end to end: a model that paraphrases its quotes still yields questions with real sentences
const art = { id: 'a', title: 'Sleep', content: paras.map(p => `<p>${p}</p>`).join('') };
const art2 = { id: 'b', title: 'Naps', content: '<p>A nap after lunch is common in many countries.</p><p>Short naps of about twenty minutes help people stay alert in the afternoon.</p>' };
let sent = '';
const fake = async (system, user) => {
  sent = user;
  if (/connect two different articles/.test(system)) return '{"questions":[]}';
  return JSON.stringify({ questions: [
    { ...base, quote: 'the brain replays the days experiences, strengthening connections between neurons' },
    { q: 'What do the researchers say delays sleep most?', options: ['Screens before bed', 'Caffeine after noon', 'Late dinners', 'Morning exercise'], correct: 0 },
    { q: 'What do short naps do?', options: ['Improve recall or alertness', 'Replace a night of sleep', 'Make people taller', 'Nothing at all'], correct: 0, quote: 'Short naps of about twenty minutes improve recall and keep you alert' },
  ], facts: ['Sleep is not a pause for the brain', 'Screens before bed delay sleep'] });
};
const res = await G.createQuiz([art], { total: 3, mix: 'article', aiComplete: fake });
assert.equal(res.questions.length, 3, 'paraphrased or missing quotes are not dropped');
assert.ok(res.questions.every(q => q.sources.every(src => src.quote && src.para >= 1)));
assert.ok(res.perArticle.every(p => p.dropped === 0), 'nothing dropped');
assert.ok(sent.includes('Screens before bed delay sleep more than caffeine after noon'), 'the whole article text was sent');
assert.ok(art2.content);
// decimals and abbreviations do not split a sentence
const dec = G.articleSentences(['Limiting warming to 1.5 °C needs emissions to fall by half. Then it gets easier.']);
assert.deepEqual(dec.map(x => x.text), ['Limiting warming to 1.5 °C needs emissions to fall by half.', 'Then it gets easier.']);
assert.equal(G.articleSentences(['日本語の文です。二つ目の文です。']).length, 2);
console.log('TEST 261 OK'); process.exit(0);
