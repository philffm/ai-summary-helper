// Firefox's AI runtime (browser.trial.ml) as a local model `firefox-ml`: summaries only. The page text is cut out of the
// summary request and handed to the summarization engine (created once), the answer comes back as summary HTML in the
// endpoint's stream format; any other request (feeds, questions) is refused with a clear message. Settings: permission button,
// about:config hint, then a model chip.
import assert from 'assert'; import fs from 'fs'; import path from 'path'; import vm from 'vm';
import { setup, imp, tick } from './harness.mjs';
const SRC = process.env.AISH_SRC;
let engines = 0; const runs = [];
const ml = {
    createEngine: async (o) => { engines++; assert.equal(o.taskName, 'summarization'); },
    runEngine: async ({ args }) => { runs.push(args[0]); return [{ summary_text: 'Short <summary> & more' }]; },
};
const ctx = { self: {}, TextEncoder, ReadableStream, Response, fetch: async () => new Response('net'), console, browser: { trial: { ml } } };
ctx.self = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'builtinAi.js'), 'utf8'), ctx);
const B = ctx.AishBuiltin;
const user = 'Language: German. Limit: 200 words. Instruction: . Additional Context/Questions: . Content: The page text here.\n\n=== FINAL INSTRUCTIONS — follow exactly ===\nOutput only the HTML';
const body = JSON.stringify({ model: 'firefox-ml', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: user }] });
let txt = await (await B.aiFetch('http://localhost:11434/api/chat', { method: 'POST', body })).text();
const html = txt.trim().split('\n').map(l => JSON.parse(l)).filter(l => !l.done).map(l => l.message.content).join('');
assert.equal(html, '<div><h2>Summary</h2><p>Short &lt;summary&gt; &amp; more</p></div>', 'summary HTML, escaped');
assert.deepEqual(runs, ['The page text here.'], 'only the page text goes to the model');
await (await B.aiFetch('http://localhost:11434/api/chat', { method: 'POST', body })).text();
assert.equal(engines, 1, 'engine created once');
// not a summary (feeds, questions): refused
const other = JSON.stringify({ model: 'firefox-ml', messages: [{ role: 'user', content: 'Rate these items' }] });
await assert.rejects((await B.aiFetch('http://x/api/chat', { method: 'POST', body: other })).text(), /can only summarize/);
// manifest
const man = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'platforms', 'firefox', 'manifest.json'), 'utf8'));
assert.ok(man.optional_permissions.includes('trialML') && man.background.scripts.indexOf('builtinAi.js') < man.background.scripts.indexOf('background.js'));

// settings block
const { w } = setup({});
Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/146.0', configurable: true });
Object.defineProperty(globalThis.navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/146.0', configurable: true });
let granted = false;
globalThis.browser = { permissions: { contains: async () => granted, request: async () => { granted = true; return true; } }, trial: {} };
const SM = await imp('modules/settingsManager.js');
const box = w.document.createElement('div'); w.document.body.append(box);
let picked = '';
await SM.__test_renderFirefoxModel(box, (id) => { picked = id; });
const allow = [...box.querySelectorAll('button')].find(b => /Allow Firefox AI/.test(b.textContent));
assert.ok(allow && /only summarizes/.test(box.textContent), 'asks for the permission and says what it can do');
allow.click(); await tick(30);
assert.ok(/about:config/.test(box.textContent) && /browser\.ml\.enable/.test(box.textContent), 'API off: the switches');
globalThis.browser.trial.ml = ml;
await SM.__test_renderFirefoxModel(box, (id) => { picked = id; });
box.querySelector('.model-id-tag').click();
assert.equal(picked, 'firefox-ml');
assert.ok(/Summaries only/.test(box.textContent) && /Ollama/.test(box.textContent), 'limits and the better option');
console.log('TEST 244 OK'); process.exit(0);
