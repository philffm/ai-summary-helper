// Links in this article (Figma AISH-041 B): which links are listed and how (sources first, with their sentence), and the section:
// Summarize asks the worker (openFeedItem), the queue shows Waiting / Summarizing…, a saved article shows its summary, a job that
// ends without one is "could not read", ticked links + this article go to a quiz.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
const L = await imp('modules/articleLinks.js');

const base = 'https://news.example/2026/11/four-day-week?utm_source=x';
const html = `
<nav><a href="/">Home</a> <a href="/subscribe">Subscribe</a> <a href="/tag/work">Work</a></nav>
<p>The UK pilot was large. According to the <a href="https://autonomy.example/reports/final-report">final report</a>, 92 % of firms kept the four-day week after the trial.</p>
<p>A study of the Icelandic trials found output stayed the same, see <a href="https://alda.example/iceland-shorter-week">this summary</a> for details on the public sector.</p>
<p>Critics point to <a href="https://www.nature.example/articles/s41586-024-0001.pdf">a recent review</a> and to <a href="https://doi.org/10.1234/abc.567">a paper</a>, and the debate goes on in many countries.</p>
<p>Japan is trying it too, as <a href="https://bbc.example/news/japan-four-day-week">the BBC wrote</a> last month about the idea.</p>
<p>Repeated: according to the <a href="https://autonomy.example/reports/final-report?utm_campaign=y">final report</a> again.</p>
<ul><li><a href="https://other.example/related-story">Related story</a></li></ul>
<p><a href="https://twitter.com/intent/tweet?text=x">Share on X</a> <a href="mailto:a@b.c">Mail</a> <a href="#top">Top</a> <a href="https://news.example/2026/11/four-day-week">self</a> <a href="https://img.example/pic.jpg">image</a></p>`;
const links = L.extractLinks(html, base);
assert.deepEqual(links.map(l => l.kind + ' ' + l.host), [
  'source autonomy.example', 'source alda.example', 'source nature.example', 'source doi.org', 'mention bbc.example', 'other other.example',
], 'sources first; nav, legal, tags, social, mail, anchors, the page itself, images and duplicates are left out');
assert.ok(/According to the final report, 92 %/.test(links[0].context), 'the sentence the link sits in');
assert.ok(links[2].pdf && links[2].paper && links[3].paper);
assert.equal(links[0].title, 'final report');
assert.equal(L.linkKey('https://www.autonomy.example/reports/final-report/?utm_source=a'), 'autonomy.example/reports/final-report');
assert.equal(L.extractLinks('<p>no links</p>', base).length, 0);
const rel = L.extractLinks('<p>As the agency’s <a href="../data/2026-report">annual report</a> shows, demand rose sharply in the past year.</p>', 'https://agency.example/news/item');
assert.equal(rel[0].url, 'https://agency.example/data/2026-report', 'relative links resolved against the article');

// the section
const sent = [];
let index = [];
const deps = {
  article: { id: 'p1', title: 'Is the four-day week working?', url: base },
  html, openArticle: (a) => { deps.opened = a; }, toast: () => {},
  getIndex: async () => index,
  send: async (msg) => { sent.push(msg); return msg.action === 'summaryJobs' ? { ok: true, running: null, queue: [] } : { success: true, queued: true }; },
};
const host = d.createElement('section'); d.body.append(host);
const view = L.mountArticleLinks(host, deps);
await tick(20);
assert.equal(host.hidden, false);
assert.match(host.querySelector('.links-title').textContent, /Links in this article\s*6/);
const caps = [...host.querySelectorAll('.links-cap')].map(c => c.textContent);
assert.deepEqual(caps, ['Sources the article cites · 4', 'Mentioned in the text · 1', 'Other links · 1']);
assert.ok(host.querySelector('details.links-group--other') && !host.querySelector('details.links-group--other').open, 'other links folded');
const batch = host.querySelector('.links-batch');
assert.equal(batch.textContent, '✨ Summarize the 4 sources');
batch.click(); await tick(10);
const asked = sent.filter(m => m.action === 'openFeedItem');
assert.equal(asked.length, 4); assert.ok(asked.every(m => m.summarize && m.forceExtension));
assert.equal(host.querySelectorAll('.links-row.is-queued').length, 4); assert.ok(batch.hidden, 'nothing left to batch');
// the worker reports the queue: one running, three waiting
view.__queue({ action: 'summaryQueue', running: { url: links[0].url }, queue: links.slice(1, 4).map(l => ({ url: l.url })) });
assert.equal(host.querySelectorAll('.links-row.is-running').length, 1); assert.equal(host.querySelectorAll('.links-row.is-queued').length, 3);
assert.match(host.querySelector('.links-row.is-running .links-state').textContent, /Summarizing/);
// the first one is saved as an article; the second left the queue without one
index = [{ id: 'c1', url: 'https://autonomy.example/reports/final-report', summary: '<p>61 firms, 6 months; <b>92 %</b> kept it.</p>' }];
view.__state.asked.set(links[1].key, Date.now() - 9000);
view.__queue({ action: 'summaryQueue', running: { url: links[2].url }, queue: [{ url: links[3].url }] });
await view.__refresh();
const done = host.querySelector('.links-row.is-done');
assert.ok(done && /61 firms, 6 months; 92 % kept it\./.test(done.querySelector('.links-sum').textContent), 'summary of the linked article');
const failed = host.querySelector('.links-row.is-failed');
assert.ok(failed && /Could not read this page/.test(failed.textContent) && /Try again/.test(failed.textContent), 'left the queue without an article: could not read');
done.querySelector('.links-open').click(); assert.equal(deps.opened.id, 'c1', 'Open goes to the article');
// tick it → bar with this article: collection and quiz
const cb = done.querySelector('.links-pick'); cb.checked = true; cb.dispatchEvent(new w.Event('change'));
const bar = host.querySelector('.links-selbar');
assert.equal(bar.hidden, false); assert.match(bar.textContent, /1 selected, with this article/);
assert.deepEqual([...bar.querySelectorAll('button')].map(b => b.textContent), ['📚 Collection', '🎓 Quiz']);
// try again asks once more, only for that one
const before = sent.filter(m => m.action === 'openFeedItem').length;
failed.querySelector('.links-go').click(); await tick(10);
const again = sent.filter(m => m.action === 'openFeedItem');
assert.equal(again.length, before + 1); assert.equal(again.at(-1).url, links[1].url);
view.destroy();
// no links → hidden
const empty = d.createElement('section'); L.mountArticleLinks(empty, { ...deps, html: '<p>Nothing here.</p>' });
assert.equal(empty.hidden, true);
console.log('TEST 262 OK'); process.exit(0);
