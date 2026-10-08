// Goodbye page (uninstall survey): form validation, survey id, thank-you state.
import { JSDOM } from 'jsdom'; import fs from 'fs'; import assert from 'assert';
const root = process.env.AISH_ROOT;
const html = fs.readFileSync(root + '/docs/goodbye.html', 'utf8');
async function load(configured) {
  const calls = []; let opened = [];
  const h = configured ? html.replace("environmentId: ''", "environmentId: 'envX'").replace("surveyId: ''", "surveyId: 'svY'") : html;
  const dom = new JSDOM(h, { url: 'https://ai-summary-helper.byphil.eu/goodbye.html?v=2.0.431&d=12', runScripts: 'dangerously', beforeParse(w) { w.fetch = async (u, o) => { calls.push({ u, o }); return { ok: true }; }; w.open = (u) => opened.push(u); w.__nav = opened; w.matchMedia = () => ({ matches: false }); } });
  return { d: dom.window.document, w: dom.window, calls, opened };
}
const submit = (w, d) => d.getElementById('byeForm').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
let { d, w, calls, opened } = await load(true);
submit(w, d); assert(!d.getElementById('byeErr').hidden, 'asks for input'); assert.equal(calls.length, 0);
d.querySelector('input[value=quality]').checked = true; d.getElementById('byeComment').value = 'too vague';
submit(w, d); await new Promise(r => setTimeout(r, 20));
assert.equal(calls.length, 1); assert(calls[0].u.endsWith('/api/v1/client/envX/responses'));
const b = JSON.parse(calls[0].o.body); assert.equal(b.surveyId, 'svY'); assert.equal(b.data.reason, 'quality'); assert.equal(b.data.comment, 'too vague'); assert(b.meta.url.includes('v=2.0.431') && b.meta.url.includes('d=12'));
assert(d.getElementById('byeDone').classList.contains('show'));
({ d, w, calls, opened } = await load(false)); d.querySelector('input[value=price]').checked = true; submit(w, d);
assert.equal(calls.length, 0); assert(true); assert(d.getElementById('byeDone').classList.contains('show'));
console.log('TEST 35 OK');
