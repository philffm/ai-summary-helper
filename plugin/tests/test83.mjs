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
console.log('TEST 83 OK'); process.exit(0);
