// Article root: picks the largest <article>/<main>, not the first (finanzen.net: a sign-in popup <article> precedes the story).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const body = 'Nebius hat CoreWeave beim Börsenwert überholt. '.repeat(40);
const { w } = setup({}); w.document.body.innerHTML = `<div class="overlay display-none"><article class="onetap-popup"><h3>Melde Dich mit Google an.</h3><p>${'Single Sign-on Datenschutz. '.repeat(8)}</p></article></div>
<main><article class="news-container"><h1>CoreWeave vs Nebius</h1><p>${body}</p></article></main>`;
globalThis.document = w.document; globalThis.window = w;
const a = await imp('content/anchor.js'); const x = await imp('content/extractor.js');
assert(a.ancScopeRoot(w.document).classList.contains('news-container'), 'anchor scope picks the story');
const { text } = x.getAllTextContent();
assert(text.includes('Börsenwert') && !text.includes('Single Sign-on'), 'extractor ignores the popup');
w.document.body.innerHTML = '<article id="m"><p>' + body + '</p></article><div role="dialog"><article>' + body + body + '</article></div>'; const d = w.document;
assert.equal(a.ancLargestMatch(d, 'article').id, 'm', 'dialog content is skipped even when larger');
assert.equal(a.ancLargestMatch(d, 'section'), null);
// Roche page: a sibling <article> whose inline <script> is longer than the story must not win (textContent counts script source)
w.document.body.innerHTML = `<div id="onetap"><article class="onetap-popup"><p>${'Google Anmeldung. '.repeat(20)}</p></article></div>
<main><article class="news-container"><h1>Roche Tecentriq</h1><p>${body}</p></article>
<article class="analysen"><h2>Roche Analysen</h2><table><tr><td>Hold</td></tr></table><script>${'var x = 1; '.repeat(800)}</script></article></main>`;
assert(a.ancScopeRoot(w.document).classList.contains('news-container'), 'script source and h2-only articles do not win');
assert(!x.getAllTextContent().text.includes('Roche Analysen'), 'extractor ignores the analysis box');
// Ordinary pages keep the old first-match result: several articles, first one has the h1 -> first; no h1 anywhere -> first
w.document.body.innerHTML = '<article id="a"><h1>T</h1><p>' + body + '</p></article><article id="b"><h1>Other</h1><p>' + body + body + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'a', 'first article with h1 stays');
w.document.body.innerHTML = '<article id="a"><p>' + body + '</p></article><article id="b"><p>' + body + body + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'a', 'no h1 anywhere, similar-looking articles: unchanged first match');
// no h1 anywhere (h2-only layouts): overlay-looking first article loses to the one with the text; plain first is kept
const big = body.repeat(3);
w.document.body.innerHTML = '<div class="login-overlay"><article id="a"><p>Melde dich an. ' + 'x'.repeat(100) + '</p></article></div><article id="b"><h2>Story</h2><p>' + big + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'b', 'furniture-looking first article is skipped without an h1');
w.document.body.innerHTML = '<article id="a"><h2>Short note</h2><p>' + body.slice(0, 600) + '</p></article><article id="b"><h2>Second</h2><p>' + body.slice(0, 900) + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'a', 'two comparable plain articles: first stays');
w.document.body.innerHTML = '<article id="a"><h2>Teaser</h2><p>kurz</p></article><article id="b"><h2>Story</h2><p>' + big + '</p></article>';
assert.equal(a.ancScopeRoot(w.document).id, 'b', 'tiny first article vs dominant later one: later wins');
console.log('TEST 85 OK'); process.exit(0);
