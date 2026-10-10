// Recap status card: stages advance with feedAi's onStage callback; aiComplete reports send → wait → parse.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
globalThis.chrome.runtime.sendMessage = (m, cb) => setTimeout(() => cb({ ok: true, text: 'Overview.\n- A\nMOOD: mixed' }), 500);
const { createRecapStatus } = await imp('modules/recapStatus.js');
const { generateRecap } = await imp('modules/feedAi.js');
const st = createRecapStatus({ title: 'Writing', detail: 'Sending 1 title' });
const cls = (n) => [...st.node.querySelectorAll('.recap-step')].map(li => li.className.replace('recap-step', '').trim());
assert.deepEqual(cls(), ['active', '', '', '', '']);
const stages = [];
const r = await generateRecap([{ id: 1, title: 'Hi', snippet: '' }], () => '', { rate: false, onStage: (s) => { stages.push(s); st.onStage(s); } });
st.stop();
assert.deepEqual(stages, ['send', 'wait', 'parse']);
assert.deepEqual(cls(), ['done', 'done', 'done', 'done', 'active']);
assert(r.overview);
// Streaming progress: aiProgress messages move the card to "writing" and show counts.
const st3 = createRecapStatus({ title: 'S' });
st3.onStage('wait'); st3.onStage('write'); st3.onStage('wait');
st3.onProgress({ phase: 'stream', chars: 120, think: 40, tail: 'abc' });
const rowsTxt = [...st3.node.querySelectorAll('.recap-step')].map(li => li.textContent);
assert(/120/.test(rowsTxt[3]) && /40/.test(rowsTxt[3]), rowsTxt[3]);
assert(st3.node.querySelectorAll('.recap-step.active')[0].textContent.startsWith('Model is writing'), 'monotonic stages');
st3.stop();
// Cancel: aborts, rejects with .cancelled and tells the worker.
const sent = [];
globalThis.chrome.runtime.sendMessage = (m, cb) => { sent.push(m.action); if (m.action === 'aiComplete') setTimeout(() => cb({ ok: true, text: 'x' }), 2000); else cb && cb({ ok: true }); };
const st2 = createRecapStatus({ title: 'W' });
const p = generateRecap([{ id: 1, title: 'Hi', snippet: '' }], () => '', { rate: false, onStage: st2.onStage, signal: st2.signal });
setTimeout(() => st2.node.querySelector('.recap-cancel').click(), 100);
await assert.rejects(p, (e) => e.cancelled === true);
assert(sent.includes('aiCancel'));
st2.stop();
// Reset button exists in both recap UIs (source check; the sheets need the full feed UI).
import fs from 'fs';
const here = new URL('../src/modules/', import.meta.url);
assert(/confirmBtn\(T\('Reset'\)/.test(fs.readFileSync(new URL('feedManager.js', here), 'utf8')));
assert(/refreshFromScratch/.test(fs.readFileSync(new URL('feedRollup.js', here), 'utf8')));
// Follow-up answers: HTML / fences / comments become clean text; SOURCES still parsed; streaming preview hides SOURCES.
const { cleanAnswer, answerPreview, parseAnswer } = await imp('modules/conversation.js');
const html = '```html\n<p>Yes, it was <strong>complex</strong>.</p>\n\n<p>Second &amp; last.</p>\n\n<ul><li>one</li><li>two</li></ul>\n<!-- Sources -->\nSOURCES: "The challenge was never the design; it was the code" | "x"\n```';
const c = cleanAnswer(html);
assert(!/[<>`]/.test(c.replace(/SOURCES.*/s, '')), c);
assert(/\*\*complex\*\*/.test(c) && /\n- one\n- two/.test(c) && /Second & last/.test(c), c);
const pa = parseAnswer(html, 'The challenge was never the design; it was the code and more.');
assert.equal(pa.sources.length, 1);
assert(!/SOURCES|<|```/.test(pa.a), pa.a);
assert.equal(answerPreview('<p>Hi <str'), 'Hi');
assert.equal(answerPreview('Plain text\nSOURCES: "abc'), 'Plain text');
// Reasoning that leaks into a summary is dropped (page script helper).
const { stripReasoning } = await imp('content/markdown.js');
assert.equal(stripReasoning('Thinking Process:\n\n1. Analyze...\n* Format: <div> in text'.replace('<div> in text', '')), '');
assert.equal(stripReasoning('Thinking Process:\n1. x\n\n<div><h2>T</h2><p>Body</p></div>'), '<div><h2>T</h2><p>Body</p></div>');
assert.equal(stripReasoning('<think>hmm</think><div>ok</div>'), '<div>ok</div>');
assert.equal(stripReasoning('<think>still going'), '');
assert.equal(stripReasoning('<div>Thinking: about UX</div>'), '<div>Thinking: about UX</div>');
// XSS (PR #20): nested markup inside an unwrapped <div> must not escape the allowlist.
const { sanitizeHtml } = await imp('content/markdown.js');
const bad = sanitizeHtml('<div><p onclick="x()">a</p><img src=x onerror="alert(1)"><a href="javascript:1">l</a><script>alert(1)</script><style>p{}</style><b onmouseover=1>b</b><h2 style="x">t</h2></div>');
assert(!/onclick|onerror|onmouseover|<img|<a |<script|<style|javascript:|style=|alert/i.test(bad), bad);
assert(/<p>a<\/p>/.test(bad) && /<h2>t<\/h2>/.test(bad), bad);
const { modelKind } = await imp('modules/modelBadge.js');
assert.equal(modelKind({ connectionMode: 'cloud', modelId: 'google/x' }), 'cloud');
assert.equal(modelKind({ connectionMode: 'local', service: 'ollama', modelId: 'qwen' }), 'ollama');
assert.equal(modelKind({ connectionMode: 'local', modelId: 'gemma4:e2b' }), 'ollama');
assert.equal(modelKind({ connectionMode: 'local', modelId: 'gpt-4o' }), 'own');
assert.equal(modelKind({ connectionMode: 'local', modelId: 'ft:gpt-4o:org' }), 'own');
assert.equal(modelKind({ connectionMode: 'local', service: 'openai', modelId: 'a:b' }), 'own');
// Follow-up answers carry the next suggestions (no extra request) and the streaming preview hides them.
const full = 'Because of the code.\nSOURCES: "The challenge was never the design; it was the code"\nQUESTIONS: ["Who paid for it?", "How long did it take?", "x"]';
const pq = parseAnswer(full, 'The challenge was never the design; it was the code and more.');
assert.equal(pq.a, 'Because of the code.');
assert.equal(pq.sources.length, 1);
assert.deepEqual(pq.questions, ['Who paid for it?', 'How long did it take?']);
assert.deepEqual(parseAnswer('Plain answer. Questions: none really.', '').questions, []);
assert.equal(answerPreview('Answer text\nQUESTIONS: ["a'), 'Answer text');
assert.equal(answerPreview('Questions about this: many'), 'Questions about this: many');
// Language rule for small models: hard rule + native-language sentence; nothing for English.
const { languageRule } = await imp('modules/languages.js');
assert.equal(languageRule('en'), '');
assert(/German/.test(languageRule('de')) && /Antworte ausschließlich auf Deutsch/.test(languageRule('de')) && /Do NOT write it in English/.test(languageRule('de')));
const contentSrc = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
assert(/FINAL INSTRUCTIONS/.test(contentSrc) && /LENGTH RULE/.test(contentSrc), 'final reminder block');
assert(/(?:content: |userMessage = )`[^`]*Content: \$\{(?:truncatedContent|pageText)\}\\n\\n\$\{finalReminder\}`/.test(contentSrc), 'reminder is the last thing in the user message');
assert(/parts\.push\(\{ text: finalReminder \}\)/.test(contentSrc), 'gemini: reminder is the last part');
const { resolveLocale } = await imp('modules/i18n.js');
assert.equal(resolveLocale('de'), 'de'); assert.equal(resolveLocale('de-DE'), 'de');
assert.equal(resolveLocale('', 'de-AT'), 'de'); assert.equal(resolveLocale('', 'en-GB'), 'en');
assert.equal(resolveLocale('pt'), 'pt_PT'); assert.equal(resolveLocale('', 'pt-BR'), 'pt_PT');
assert.equal(resolveLocale('zh-TW'), 'zh_TW'); assert.equal(resolveLocale('', 'zh-Hant'), 'zh_TW'); assert.equal(resolveLocale('zh'), 'zh_CN'); assert.equal(resolveLocale('', 'zh-HK'), 'zh_HK');
assert.equal(resolveLocale('', 'sv-SE'), 'en'); assert.equal(resolveLocale('ar'), 'ar');
// Send sheet: the digest intro uses the shared status card with streamed preview; cancel = skip intro.
const stI = createRecapStatus({ title: 'Intro', preview: true });
stI.onProgress({ phase: 'stream', chars: 5, think: 0, tail: 'He', text: '**Hello** world' });
assert.equal(stI.node.querySelector('.recap-preview').textContent, 'Hello world');
assert.equal(stI.node.querySelector('.recap-preview').hidden, false);
stI.stop();
const ss = fs.readFileSync(new URL('../src/modules/sendSheet.js', import.meta.url), 'utf8');
assert(/createRecapStatus\(\{[\s\S]*preview: true/.test(ss) && /generateDigestIntro\(list0, state\.introStyle, \{ onStage/.test(ss));
// Suggested questions cost no extra request: they ride along with the summary, the last instructions repeat the ask,
// parsing is forgiving, and there is no separate suggestion call any more.
{
  const c = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const m = fs.readFileSync(new URL('mainScreen.js', here), 'utf8');
  assert(/FINAL INSTRUCTIONS[\s\S]*QUESTIONS: \[\{"q":"\.\.\."/.test(c), 'QUESTIONS in the final reminder');
  assert(/QUESTIONS:\\s\*\(\[\\s\\S\]\*\?\)\\s\*\(\?:-->\|\$\)/.test(fs.readFileSync(new URL('../src/content/finalize.js', import.meta.url), 'utf8')) && /matchAll\(\/\["“\]/.test(fs.readFileSync(new URL('../src/modules/suggestions.js', import.meta.url), 'utf8')), 'forgiving parsing');
  assert(!/buildSuggestPrompt|parseSuggestions/.test(m), 'no second request for suggestions');
}
console.log('TEST 59 OK'); process.exit(0);
