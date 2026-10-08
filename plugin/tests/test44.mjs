// Follow-ups: turns, source parsing, persistence on the article record, pin toggle, History view, exports.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
const C = await imp('modules/conversation.js');
const V = await imp('modules/qaView.js');
const { default: SM } = await imp('modules/storageManager.js');
const { SK } = await imp('modules/storageKeys.js');

// pin default: only the first follow-up
const t1 = C.newTurn([], { q: 'Why?', a: 'Because.' });
const t2 = C.newTurn([t1], { q: 'And?', a: 'Also.' });
assert.equal(t1.pinned, true); assert.equal(t2.pinned, false); assert(t1.id !== t2.id);

// answer parsing: quotes must really occur in the page text; duplicates and invented quotes are dropped
const page = '<p>The committee voted on Tuesday to approve the new budget after a long debate.</p><p>Nothing else happened.</p>';
const raw = 'It was approved.\nSOURCES: "voted on Tuesday to approve the new budget" | "this sentence is invented by the model" | "Voted on Tuesday to approve the new budget"';
const p = C.parseAnswer(raw, page);
assert.equal(p.a, 'It was approved.'); assert.deepEqual(p.sources, ['voted on Tuesday to approve the new budget']);
assert.deepEqual(C.parseAnswer('Just text', page), { a: 'Just text', sources: [], questions: [] });
assert.deepEqual(C.parseSuggestions('Sure!\n["Who disagrees?", "What are the costs?", "ab", "Next steps for users?", "extra one here"]'), ['Who disagrees?', 'What are the costs?', 'Next steps for users?']);
assert.deepEqual(C.parseSuggestions('no json'), []);

// prompt: page text capped, only the last 6 turns go back
const many = Array.from({ length: 9 }, (_, i) => ({ q: 'q' + i, a: 'a' + i }));
const pr = C.buildPrompt({ title: 'T', content: 'x'.repeat(30000), summary: '<p>S</p>', turns: many, question: 'now?' });
assert(pr.user.length < 22000 && pr.user.includes('q8') && pr.user.includes('q3') && !pr.user.includes('Q: q2\n'), 'last 6 turns');
assert(pr.system.includes('SOURCES'));

// html / markdown blocks
assert.equal(C.qaHtml([t2], {}), ''); assert(C.qaHtml([t1, t2], {}).includes('Why?') && !C.qaHtml([t1, t2], {}).includes('And?'));
assert(C.qaHtml([t1, t2], { all: true }).includes('And?'));
assert(C.withQuestions('<p>S</p>', [t1], {}).startsWith('<p>S</p><section'));
assert(C.qaMarkdown([t1, t2], {}).includes('**Why?**') && !C.qaMarkdown([t1, t2], {}).includes('And?'));
assert(C.qaHtml([{ ...t1, q: '<b>x</b>' }], {}).includes('&lt;b&gt;'), 'escaped');

// persistence on the record + index counter
const { id } = await SM.saveArticle({ content: '<p>c</p>', summary: '<p>s</p>', url: 'https://a.com/x', title: 'A' });
assert.deepEqual(await SM.getConversation(id), []);
assert(await SM.saveConversation(id, [t1, t2]));
assert.equal((await SM.getConversation(id)).length, 2);
assert.equal(store[SK.articlesIndex].find(a => a.id === id).qaCount, 2);
assert.equal(store['articles:rec:' + id].content, '<p>c</p>', 'record content untouched');
assert.equal((await SM.getArticleFull(id)).conversation.length, 2);
assert(!(await SM.saveConversation('nope', [t1])));
await SM.saveConversation(id, []); assert(!('qaCount' in store[SK.articlesIndex].find(a => a.id === id)));
// suggested follow-up questions are kept with the article for later (and survive a turn being saved without them)
assert(await SM.saveConversation(id, [t1], ['Who paid?', '', 'How long?']));
assert.deepEqual(await SM.getSuggested(id), ['Who paid?', 'How long?']);
await SM.saveConversation(id, [t1]); assert.deepEqual(await SM.getSuggested(id), ['Who paid?', 'How long?'], 'pool untouched when not passed');
assert.deepEqual(await SM.getSuggested('nope'), []);
await SM.saveConversation(id, [t1, t2]);
// the pinned question is part of the stored summary (and the index), the original is kept as summaryBase
let rec = store['articles:rec:' + id]; let ix = store[SK.articlesIndex].find(a => a.id === id);
assert.equal(rec.summaryBase, '<p>s</p>');
assert(rec.summary.startsWith('<p>s</p>') && rec.summary.includes('Why?') && !rec.summary.includes('And?'), 'only pinned appended');
assert.equal(ix.summary, rec.summary, 'index summary follows');
// pin the second, then unpin everything: never doubles up, fully restores
t2.pinned = true; await SM.saveConversation(id, [t1, t2]);
rec = store['articles:rec:' + id]; assert(rec.summary.includes('And?') && rec.summary.split('aish-qa').length === 2, 'one block, both questions');
await SM.saveConversation(id, []); rec = store['articles:rec:' + id];
assert.equal(rec.summary, '<p>s</p>'); assert.equal(store[SK.articlesIndex].find(a => a.id === id).summary, '<p>s</p>');
t2.pinned = false; await SM.saveConversation(id, [t1, t2]);

// view: pinned inline, rest collapsed, pin toggle + export switch call back
let pins = 0, all = null, reveals = [];
const sec = V.qaSection([t1, t2], { onPin: () => pins++, onIncludeAll: v => { all = v; }, onSource: q => reveals.push(q) });
d.body.appendChild(sec);
assert.equal(sec.querySelectorAll(':scope > .chat-turn-group').length, 1, 'one pinned inline');
assert(sec.querySelector('details.qa-more') && /1 more question/.test(sec.querySelector('details summary').textContent));
sec.querySelector('details .chat-pin').click(); assert.equal(pins, 1); assert.equal(t2.pinned, true);
const cb = sec.querySelector('.qa-all input'); cb.checked = true; cb.dispatchEvent(new w.Event('change')); assert.equal(all, true);
const withSrc = V.turnEl({ ...t1, sources: ['voted on Tuesday to approve the new budget'] }, { onSource: q => reveals.push(q) });
withSrc.querySelector('.chat-src').click(); assert.deepEqual(reveals, ['voted on Tuesday to approve the new budget']);
t2.pinned = false;

// exports: pinned only by default, everything when the switch is on
const AM = await imp('modules/articleManager.js');
const full = await SM.getArticleFull(id);
const html1 = await AM.__test_buildDoc?.(full);
if (html1) {
  assert(html1.includes('Why?') && !html1.includes('And?'));
  store[SK.exportAllQuestions] = true;
  assert((await AM.__test_buildDoc(full)).includes('And?'));
  store[SK.exportAllQuestions] = false;
}
console.log('TEST 44 OK');
