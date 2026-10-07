// Conversational Summarize: composer state machine, status/context rows, different-page rule.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); const d = w.document;
d.body.innerHTML = `<div class="controls-bar"><div class="input-card"><label class="input-card-label">Focus</label>
<textarea id="additionalQuestions" placeholder="Ask specific questions about this page…"></textarea>
<button id="fetchSummary">✨ Fetch Summary</button></div></div>`;
const m = await imp('modules/composerState.js');
const bar = d.querySelector('.controls-bar'); const btn = d.getElementById('fetchSummary'); const ta = d.getElementById('additionalQuestions');
const seen = []; const c = m.createComposer(bar, { onChange: (n, p) => seen.push(p + '>' + n) });
assert.equal(c.state, 'fetch'); assert.equal(bar.dataset.state, 'fetch'); assert(!d.querySelector('.input-card-label').hidden);
c.set('working');
assert.equal(bar.dataset.state, 'working'); assert(btn.textContent.includes('Stop')); assert(d.querySelector('.input-card-label').hidden);
c.set('followup');
assert(btn.textContent.includes('Send')); assert(/follow-up/i.test(ta.placeholder));
c.set('fetch');
assert(btn.textContent.includes('Fetch Summary')); assert.equal(ta.placeholder, 'Ask specific questions about this page…');
c.set('bogus'); c.set('fetch');
assert.deepEqual(seen, ['fetch>working', 'working>followup', 'followup>fetch']);
// different-page rule ignores hash + trailing slash, not path/query
assert(m.samePage('https://a.com/x/#top', 'https://a.com/x'));
assert(!m.samePage('https://a.com/x', 'https://a.com/y'));
assert(!m.samePage('https://a.com/x?p=1', 'https://a.com/x?p=2'));
assert(!m.samePage('', 'https://a.com'));
// status lines + "What I used" only list what was really sent
const none = m.contextRows({ words: 1200, host: 'a.com', highlights: 0, focus: false, source: '', language: 'English', length: 200, model: 'Gemini' });
assert.deepEqual(none.map(r => r.key), ['page', 'settings']);
assert(none[0].text.includes('1,200') && none[0].text.includes('a.com'));
const all = m.contextRows({ words: 90, shortened: true, host: 'b.com', highlights: 3, focus: true, source: 'feed.com', length: 100 });
assert.deepEqual(all.map(r => r.key), ['page', 'highlights', 'focus', 'source', 'settings']);
assert(all[0].text.includes('shortened'));
assert.equal(m.statusLines({ words: 10, highlights: 0, length: 150 }).length, 2);
const withHl = m.statusLines({ words: 10, highlights: 4, length: 150 });
assert.equal(withHl.length, 3); assert(withHl[1].includes('4'));
console.log('TEST 43 OK');
