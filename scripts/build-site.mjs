#!/usr/bin/env node
// scripts/build-site.mjs
//
// Assembles the English source-of-truth pages in docs/ from hand-edited
// templates + shared partials in site-src/. This runs BEFORE
// translate.mjs — translate.mjs treats its output (docs/*.html) as the
// canonical English source, so translated pages inherit whatever nav/
// footer content this step produced.
//
// Why this exists: previously every page (index.html, each blog post)
// carried its own copy-pasted <header>/<footer> markup. Editing the nav
// meant hand-editing it in N files, and — as a real example — the
// homepage and blog footers had already drifted out of sync with each
// other. This step makes each partial exist in exactly one place.
//
// Nothing here is client-side. Output is plain static HTML, identical in
// spirit to what was already being served — a crawler or answer engine
// sees no difference from before.
//
// Usage:
//   node scripts/build-site.mjs

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { localizedPath } from './lib/localized-paths.mjs';

const ROOT = process.cwd();
const SITE_SRC = path.join(ROOT, 'site-src');
const PAGES_DIR = path.join(SITE_SRC, 'pages');
const PARTIALS_DIR = path.join(SITE_SRC, 'partials');
const OUT_DIR = path.join(ROOT, 'docs');
const LOCALES_PATH = path.join(OUT_DIR, 'i18n', 'locales.json');
const SITE_BASE = 'https://ai-summary-helper.byphil.eu';

// One place for the product name (the rename is undecided): pages written with {{product}} pick it up from site-src/site.json.
const PRODUCT = JSON.parse(await readFile(path.join(SITE_SRC, 'site.json'), 'utf8')).product;

const INCLUDE_RE = /<!--include:([a-zA-Z0-9_-]+)-->/g;
const HOMEPAGE_SOURCE = await readFile(path.join(PAGES_DIR, 'index.html'), 'utf8');
const FEATURES_START = HOMEPAGE_SOURCE.indexOf('<!-- ── Features');
const FEATURES_END = HOMEPAGE_SOURCE.indexOf('<!-- ── Phone companion', FEATURES_START);
if (FEATURES_START < 0 || FEATURES_END < 0) throw new Error('Could not locate the shared What it does section in the homepage.');
const WHAT_IT_DOES = HOMEPAGE_SOURCE.slice(FEATURES_START, FEATURES_END);
const FAQ_START = HOMEPAGE_SOURCE.indexOf('<!-- ── FAQ');
const FAQ_END = HOMEPAGE_SOURCE.indexOf('<!-- ── Blog teaser', FAQ_START);
if (FAQ_START < 0 || FAQ_END < 0) throw new Error('Could not locate the shared FAQ section in the homepage.');
const SHARED_FAQ = HOMEPAGE_SOURCE.slice(FAQ_START, FAQ_END);
const RELATED_READING = {
    pdf: [
        ['Guide', 'Check an AI summary against its source', 'blog/verify-ai-summary.html', 'A quick source-checking habit for any AI answer.'],
        ['Workflow', 'Highlighting alone barely works. Ask about it instead.', 'blog/highlighting-vs-asking.html', 'Turn important passages into questions you can revisit.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Understand BYOK, provider boundaries and local models.']
    ],
    youtube: [
        ['Guide', 'Turn videos into notes without losing the source', 'blog/videos.html', 'See the video workflow and the extension in action.'],
        ['Workflow', 'Highlighting alone barely works. Ask about it instead.', 'blog/highlighting-vs-asking.html', 'Keep the useful idea, not just a timestamp.'],
        ['Product', 'You won’t read most of what you save. Here’s the actual fix.', 'blog/unread-saves.html', 'Make saved video reading returnable instead of forgotten.']
    ],
    rss: [
        ['Workflow', 'One recap instead of 40 feeds', 'blog/feeds-recap.html', 'Turn your own RSS sources into a focused daily briefing.'],
        ['Architecture', 'Why we moved search, tagging and recommendations out of the cloud', 'blog/on-device-architecture.html', 'Keep your curated news archive on your own device.'],
        ['MCP', 'Use your library in Claude, LM Studio and Cursor', 'blog/ai-apps-mcp.html', 'Connect current reading context to the tools you choose.']
    ],
    research: [
        ['Guide', 'Check an AI summary against its source', 'blog/verify-ai-summary.html', 'Keep claims tied to the paper they came from.'],
        ['Research', 'Search and tags without the cloud', 'blog/on-device-architecture.html', 'See why the research library runs on your device.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Choose the model and provider behind your workflow.']
    ],
    obsidian: [
        ['Workflow', 'Search and tags without the cloud', 'blog/on-device-architecture.html', 'Build a searchable knowledge base without uploading it.'],
        ['Guide', 'Sync your reading library to Nextcloud, S3 or a folder', 'blog/sync-to-nextcloud-s3-or-a-folder.html', 'Back up and reuse your archive on your own storage.'],
        ['Product', 'From a bookmarklet to 2.0: what AI Summary Helper actually is now', 'blog/from-bookmarklet-to-2.html', 'See how saving became a connected reading workflow.']
    ],
    privacy: [
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'What BYOK protects, and where the provider boundary is.'],
        ['Architecture', 'Why we moved search, tagging and recommendations out of the cloud', 'blog/on-device-architecture.html', 'The local-first decisions behind the archive.'],
        ['Guide', 'Digital sovereignty for individuals', 'blog/digital-sovereignty-for-individuals.html', 'A practical checklist for keeping control of your data.']
    ],
    graph: [
        ['Architecture', 'Why we moved search, tagging and recommendations out of the cloud', 'blog/on-device-architecture.html', 'How local search and recommendations make the graph useful.'],
        ['Product', 'You won’t read most of what you save. Here’s the actual fix.', 'blog/unread-saves.html', 'Use digests to return to the knowledge you already collected.'],
        ['Guide', 'Sync your reading library to Nextcloud, S3 or a folder', 'blog/sync-to-nextcloud-s3-or-a-folder.html', 'Keep the connected archive on storage you control.']
    ],
    mcp: [
        ['MCP', 'Use your library in Claude, LM Studio and Cursor', 'blog/ai-apps-mcp.html', 'Give compatible AI apps controlled access to your local library.'],
        ['Privacy', 'Digital sovereignty for individuals', 'blog/digital-sovereignty-for-individuals.html', 'Understand local context, permissions and ownership.'],
        ['Privacy', 'Your key. Your model. Your data.', 'blog/bring-your-own-key.html', 'Choose which provider handles a request and which does not.']
    ]
};

const EVIDENCE_COPY = {
    researcher: ['Read a paper like you mean it', 'Four things that happen between the PDF and your notes.'],
    feeds: ['Less scrolling, more reading', 'Four ways to turn a pile of feeds into something you actually finish.'],
    video: ['Watch less, understand more', 'Four ways to get to the point of a video and back to the proof.'],
    hoarder: ['Make your saved reading come back', 'Four ways an archive can earn its place instead of piling up.'],
    privacy: ['You choose where it runs', 'Four things you control when the AI reads for you.'],
    mcp: ['What your AI app can and cannot do', 'The limits are built in and you set them. The details are in the open-source relay documentation.']
};

function evidenceSection(persona) {
    const [title, intro] = EVIDENCE_COPY[persona] || EVIDENCE_COPY.privacy;
    // Mostly product moments that invite you to try something; a source only where a finding really earns it ('' = none).
    const slidesByPersona = {
        researcher: [
            ['Trust, but jump', 'Every answer leads back to its passage', 'Ask a question and the answer points to the sentence in the paper. A quote that does not appear word for word in the text is dropped. A match shows the passage exists; reading around it stays your job.', '', ''],
            ['DOI in, citation out', 'Papers are recognised by their DOI', 'Trial, review or preprint, plus design, sample and limitations. The citation comes from the DOI registry, not from the AI.', '', ''],
            ['Five papers, one question', 'Compare before you conclude', 'Bundle articles on one question, label each as peer-reviewed, preprint, news or opinion, and see where the summaries agree, disagree or miss context.', '', ''],
            ['Location over content', 'Keep the paper findable', 'When people expect to look something up later, they remember where to find it more than the content itself. A source-linked archive keeps that location useful.', 'Sparrow, Liu & Wegner (2011), Science', 'https://doi.org/10.1126/science.1207745']
        ],
        feeds: [
            ['40 tabs, one briefing', 'Follow the sources you trust', 'A built-in RSS reader: filter by source, tag, date or mood, import OPML and summarize any item in one click. Podcast feeds play inside the extension, with an optional AI recap.', '', ''],
            ['Listen while it writes', 'Instant read', 'The summary is read aloud while it is still being written, title first, then sentence by sentence, with pause, mute and speed controls.', '', ''],
            ['Heavy news? Filter for good.', 'Mood filter and mood over time', 'Rate headlines from heavy to good, filter for the good ones and track your reading mood by day, week or month.', '', ''],
            ['Check who is behind it', 'Compare before concluding', 'Reading laterally means checking who is behind a claim and comparing it with other sources before you draw a conclusion.', 'Wineburg & McGrew (2019)', 'https://doi.org/10.1177/016146811912101102']
        ],
        video: [
            ['From the captions', 'Summarize a video without watching all of it', 'Key points from the YouTube captions, in your language, with follow-up questions answered with source citations.', '', ''],
            ['Back to the moment', 'Ask the transcript', 'Answers cite where they come from in the transcript, so you can go back to that moment and check it yourself.', '', ''],
            ['20+ languages', 'A lecture in any language, summarized in yours', 'Read and summarize in 20+ languages, with the extension, the native side panel or the bookmarklet when the extension cannot reach a page.', '', ''],
            ['Pause and process one idea', 'Learner-paced segments help', 'Learner-paced segmentation can improve retention and transfer, although it often increases the time needed to learn.', 'A meta-analysis of the segmenting effect (2019)', 'https://doi.org/10.1007/s10648-018-9456-4']
        ],
        hoarder: [
            ['Save on purpose', 'A reason and a date, not just a bookmark', 'Save a decision with its reason and timeframe, then get reminded before it disappears into an unread pile.', '', ''],
            ['One note, everything', 'Export to Obsidian or Markdown', 'Send summaries to Obsidian, Markdown, Word, OpenDocument or PDF with the title, source, tags and highlights in one note.', '', ''],
            ['See the connections', 'A graph, not just a list', 'See how saved articles connect through shared tags and topic similarity, even when they have no tag in common.', '', ''],
            ['Retrieval beats rereading', 'Ask, don’t just reread', 'Testing yourself after reading often supports later retention better than studying the material again. Questions give a saved item a reason to be revisited.', 'Roediger & Karpicke (2006), Psychological Science', 'https://doi.org/10.1111/j.1467-9280.2006.01693.x']
        ],
        privacy: [
            ['Your model', 'Ollama, your own key, or a custom endpoint', 'Choose OpenAI, Gemini, Mistral, DeepSeek, a custom endpoint or local Ollama. With Ollama the summary never leaves your device.', '', ''],
            ['What I used', 'See exactly what the AI read', '“What I used” shows the words, tokens and model behind each summary.', '', ''],
            ['Your storage', 'Sync an encrypted library to your own server', 'Sync to Nextcloud, WebDAV, S3 or a local folder. The library is encrypted and we run no sync server.', '', ''],
            ['Honest about keys', 'Your key does not make it local', 'With your own key, the request and any context in it go to the provider you chose. Only a local model keeps it on your device.', '', '']
        ],
        mcp: [
            ['Read-only', 'Your AI app can read, not edit', 'Connected apps can search your saved articles, summaries, highlights, collections and feeds. They cannot edit or delete anything, and nothing works while the browser is closed. The one write is saving a link to your inbox, marked “added by AI app”, and only if you allow it.', 'aish-mcp documentation, What it can and can’t do', 'https://github.com/philffm/ai-summary-helper/blob/main/mcp/README.md'],
            ['Off by default', 'You switch each permission on', 'The feature is off until you turn it on in AISH settings. Full article text, feeds and saving links are separate switches, and anything you have not enabled is refused inside the extension. Articles tagged private never appear in a result.', 'aish-mcp documentation, Security notes', 'https://github.com/philffm/ai-summary-helper/blob/main/mcp/README.md'],
            ['Local only', 'Paired, checked, not reachable from the web', 'The relay listens on 127.0.0.1 only. The extension connects to it with a pairing token, and a web page cannot drive it. One command, aish-mcp reset, makes the old token stop working immediately.', 'aish-mcp documentation, Security notes', 'https://github.com/philffm/ai-summary-helper/blob/main/mcp/README.md'],
            ['Ask your library', 'What you can ask once it is connected', 'For example: “Do any of my saved articles on this topic disagree? Show both sides with sources.” Your AI app sends only what it needs to its own model; the relay keeps no library data.', 'aish-mcp documentation, Try asking', 'https://github.com/philffm/ai-summary-helper/blob/main/mcp/README.md']
        ]
    };
    // One photo per evidence slide, chosen per persona so the landing pages do not all repeat the same four pictures.
    const IMAGES = {
        researcher: ['scene-student-research-carrel', 'latina-woman-document-stack', 'older-man-highlights-monitor', 'student-wheelchair-library'],
        feeds: ['older-man-kitchen-tablet', 'commuter-train-reading', 'students-classroom-reading', 'older-man-highlights-monitor'],
        video: ['scene-student-teacher-evidence', 'students-studying-together', 'teacher-grading-papers', 'students-classroom-reading'],
        hoarder: ['woman-cafe-knowledge-graph', 'student-wheelchair-library', 'latina-woman-document-stack', 'evening-sofa-ereader'],
        privacy: ['older-woman-home-nas-desk', 'it-specialist-server-room', 'nas-shelf-laptop-phone', 'offline-laptop-cable'],
        mcp: ['older-woman-home-nas-desk', 'it-specialist-server-room', 'offline-laptop-cable', 'woman-cafe-knowledge-graph']
    };
    const pics = IMAGES[persona] || IMAGES.privacy;
    const slides = (slidesByPersona[persona] || slidesByPersona.privacy).map((s, i) => [...s.slice(0, 5), `${pics[i]}-1600.webp`]);
    const total = slides.length + 1;
    return `<section class="landing-evidence"><div class="wrap"><div class="section-head center reveal"><div class="eyebrow">In practice</div><h2>${title}</h2><p>${intro}</p></div><div class="cx cx--fit reveal" data-carousel role="region" aria-roledescription="carousel" aria-label="Evidence and live demo for this reading workflow"><ul class="cx-track">${slides.map(([big, heading, text, source, href, image], i) => `<li class="cx-slide${i === 0 ? ' is-active' : ''}" aria-roledescription="slide" aria-label="${i + 1} / ${total}"><figure><div class="cx-card" style="--img:url({{base}}assets/photo/${image})"><span class="cx-big cx-big--text">${big}</span><strong class="cx-title">${heading}</strong><span class="cx-text">${text}</span>${href ? `<small class="cx-src">Source: <a href="${href}" target="_blank" rel="noopener">${source}</a></small>` : ''}</div></figure></li>`).join('')}${landingDemoSlide(persona, slides.length)}</ul><button type="button" class="cx-nav cx-prev" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="cx-nav cx-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="cx-dots">${slides.map((_, i) => `<button type="button" class="cx-dot${i === 0 ? ' is-active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}<button type="button" class="cx-dot cx-dot--demo" aria-label="Go to live demo slide">Demo</button><button type="button" class="cx-dot cx-dot--demo-m" aria-label="Go to live demo slide">Demo</button></div></div></div></section>`;
}

function demoConfig(persona) {
    const demos = {
        researcher: ['See a paper in the real interface', 'Open a research paper, inspect its summary and return to the saved reading context.', 'scenario=paper&screen=history'],
        feeds: ['Build a briefing from your own feeds', 'Open the feed reader, review current items and keep the sources behind the briefing visible.', 'screen=feeds'],
        youtube: ['Turn a long video into a return path', 'Open a long lecture, inspect its transcript-backed summary and jump back to the moment behind an answer.', 'scenario=youtube'],
        hoarder: ['Turn saved reading into a return path', 'Open the local library, search what you saved and follow the source back to the article.', 'screen=history'],
        privacy: ['Choose the model boundary yourself', 'Open the model settings and see where local, BYOK and hosted-provider choices differ.', 'panel=models'],
        mcp: ['Connect a local archive with explicit scope', 'Open the MCP settings and inspect the connected tools and access boundary.', 'scenario=mcp&panel=mcp']
    };
    return demos[persona] || demos.privacy;
}

function landingDemoSlide(persona, index) {
    const [title, intro, params] = demoConfig(persona);
    const query = `?${params}`;
    const mobileParams = `${params}&chrome=0&tour=0&surface=sidepanel`;
    return `<li class="cx-slide cx-slide--demo" aria-roledescription="slide" aria-label="${index + 1} / ${index + 1}" data-desktop-only><figure><div class="demo-frame" data-demo data-demo-scale="1180" data-demo-params="${params.replace(/&/g, '&amp;')}" data-src="{{base}}demo/index.html"><button class="demo-start" type="button"><span class="demo-play" aria-hidden="true">▶</span><span>Start the live demo</span></button><a class="demo-open" href="{{base}}demo/index.html${query}" target="_blank" rel="noopener">Open full screen ↗</a></div><figcaption><strong>${title}</strong><span>${intro} Nothing is sent from the demo.</span></figcaption></figure></li><li class="cx-slide cx-slide--demo-m" aria-roledescription="slide" aria-label="${index + 1} / ${index + 1}" data-mobile-only><figure><div class="demo-frame demo-frame--phone" data-demo data-demo-fit="420x800" data-demo-params="${mobileParams.replace(/&/g, '&amp;')}" data-src="{{base}}demo/index.html"><button class="demo-start" type="button"><span class="demo-play" aria-hidden="true">▶</span><span>Try it right here</span></button></div><figcaption><strong>${title}</strong><span>${intro}</span><a class="demo-open-m" href="{{base}}demo/index.html?${mobileParams}" target="_blank" rel="noopener">Open full screen ↗</a></figcaption></figure></li>`;
}

function filteredFeatureSection(persona) {
    const $ = cheerio.load(WHAT_IT_DOES, { decodeEntities: false });
    $('#features').attr('data-default-persona', persona);
    $('#featureGrid .feature-card').each((_, card) => {
        const personas = ($(card).attr('data-personas') || '').split(/\s+/);
        if (!personas.includes(persona)) $(card).remove();
    });
    return $('body').html().replace(/[ \t]+$/gm, '');
}

function filteredFaqSection(persona) {
    const $ = cheerio.load(SHARED_FAQ, { decodeEntities: false });
    $('#faqList details').each((_, item) => {
        const personas = ($(item).attr('data-faq-personas') || 'all').split(/\s+/);
        if (!personas.includes(persona)) $(item).remove();
    });
    return $('body').html().replace(/[ \t]+$/gm, '');
}

function landingHeroVideo(persona) {
    const videos = {
        privacy: ['privat', 'See what stays on your device'],
        feeds: ['feeds', 'Turn your feeds into a focused briefing'],
        researcher: ['recherche', 'Read a paper without losing the source'],
        video: ['ytvideo', 'Summarize a video and return to the passage'],
        graph: ['graph', 'Connect what you read'],
        mcp: ['mcp', 'Connect your library to an AI app'],
        export: ['export', 'Keep your reading trail in your notes']
    };
    const [clip, label] = videos[persona] || videos.privacy;
    return `<figure class="landing-hero-video" data-blog-video="${clip}"><video muted autoplay loop playsinline controls preload="metadata" width="360" height="520" poster="{{base}}assets/blog/video/${clip}-en.jpg" aria-label="${label}"><source src="{{base}}assets/blog/video/${clip}-en.mp4" type="video/mp4"><track kind="subtitles" srclang="en" label="English" src="{{base}}assets/blog/video/${clip}-en.vtt"></video><figcaption>${label}</figcaption></figure>`;
}

function relatedReadingSection(topic) {
    const cards = RELATED_READING[topic];
    if (!cards) throw new Error(`Unknown related-reading topic "${topic}".`);
    return `<section class="related-reading"><div class="wrap"><div class="section-head center"><div class="eyebrow">Further reading</div><h2>Go deeper on this workflow</h2><p>Practical notes on the ideas behind this page.</p></div><div class="blog-grid">${cards.map(([label, title, href, text]) => `<a class="blog-card" href="{{base}}${href}"><span class="blog-date">${label}</span><h3>${title}</h3><p>${text}</p><span class="blog-read">Read the post →</span></a>`).join('')}</div></div></section>`;
}

async function loadPartials() {
    const files = await readdir(PARTIALS_DIR);
    const partials = {};
    for (const f of files) {
        if (!f.endsWith('.html')) continue;
        const name = f.replace(/\.html$/, '');
        partials[name] = await readFile(path.join(PARTIALS_DIR, f), 'utf8');
    }
    return partials;
}

async function walk(dir, base = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const rel = path.join(base, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(await walk(path.join(dir, entry.name), rel));
        } else if (entry.name.endsWith('.html')) {
            files.push(rel);
        }
    }
    return files;
}

function baseFor(relPath) {
    // How many "../" a page needs to reach docs/ root, based on its own
    // depth under pages/. index.html -> "", blog/index.html -> "../".
    const depth = relPath.split(path.sep).length - 1;
    return '../'.repeat(depth);
}

/** SEO: point search engines at the sibling-locale versions of this English page. */
function addHreflangTags($, config, relPath) {
    const head = $('head');
    $('link[rel="alternate"][hreflang]').remove();
    const entry = (hreflang, href) => `<link rel="alternate" hreflang="${hreflang}" href="${href}">`;
    head.append(entry('x-default', `${SITE_BASE}/${relPath}`));
    head.append(entry('en', `${SITE_BASE}/${relPath}`));
    for (const [code, loc] of Object.entries(config.locales)) {
        head.append(entry(loc.hreflang, `${SITE_BASE}/${loc.dir}/${localizedPath(relPath, code)}`));
    }
}

async function buildPage(relPath, partials, config) {
    const srcPath = path.join(PAGES_DIR, relPath);
    let html = await readFile(srcPath, 'utf8');
    const base = baseFor(relPath);

    // Resolve includes. A partial can itself reference {{base}}, so we
    // substitute per-page, not once globally.
    html = html.replace(/<!--include:what-it-does:([a-z]+)-->/g, (_, persona) => filteredFeatureSection(persona));
    html = html.replace(/<!--include:evidence:([a-z]+)-->/g, (_, persona) => evidenceSection(persona));
    html = html.replace(/<!--include:hero-video:([a-z]+)-->/g, (_, persona) => landingHeroVideo(persona));
    html = html.replace(/<!--include:landing-demo:([a-z]+)-->/g, '');
    html = html.replaceAll('<!--include:landing-demo-->', '');
    html = html.replace(/<!--include:faq:([a-z]+)-->/g, (_, persona) => filteredFaqSection(persona));
    html = html.replace(/<!--include:related:([a-z]+)-->/g, (_, topic) => relatedReadingSection(topic));
    html = html.replace(INCLUDE_RE, (match, name) => {
        if (!(name in partials)) {
            throw new Error(`${relPath}: unknown partial "${name}" (looked in site-src/partials/${name}.html)`);
        }
        return partials[name].trimEnd();
    });

    html = html.replaceAll('{{base}}', base);
    html = html.replaceAll('{{product}}', PRODUCT);

    // Reciprocal hreflang: every translated page already points back at
    // this English page as an alternate (translate.mjs handles that) —
    // this page needs to point at all of THEM too, or Google can discard
    // the whole hreflang cluster as unconfirmed.
    if (config) {
        const $ = cheerio.load(html, { decodeEntities: false });
        // Native pages (written in another language, e.g. site-src/pages/de/...) carry their own hreflang tags: the generic
        // ones below describe an English page and its translations, so they would label a German page as "en".
        // (a page with <meta name="aish:hreflang" content="custom"> brings its own alternates, e.g. /education/ <-> /de/bildung/)
        if (($('html').attr('lang') || 'en').toLowerCase().startsWith('en') && !$('meta[name="aish:hreflang"][content="custom"]').length) addHreflangTags($, config, relPath);
        // Landing pages with a sibling in another language (e.g. /education/ <-> /de/bildung/): the language pills of the menu go to that
        // sibling instead of the other language's home page.
        // Only for pages that declare their own, real siblings: a native page (not English) or a page with <meta name="aish:hreflang" content="custom">.
        if ($('meta[name="aish:landing"]').length && (($('html').attr('lang') || 'en').toLowerCase() !== 'en' || $('meta[name="aish:hreflang"][content="custom"]').length)) {
            $('link[rel="alternate"][hreflang]').each((_, el) => {
                const h = ($(el).attr('hreflang') || '').toLowerCase();
                if (h === 'x-default') return;
                let pth; try { pth = new URL($(el).attr('href')).pathname; } catch { return; }
                $(`a.lang-pill[data-loc="${h}"]`).attr('href', pth);
            });
        }
        html = $.html();
    }

    const outPath = path.join(OUT_DIR, relPath);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
    return outPath;
}

async function main() {
    const partials = await loadPartials();
    const pages = await walk(PAGES_DIR);

    if (pages.length === 0) {
        console.error(`No pages found under ${PAGES_DIR}`);
        process.exit(1);
    }

    let config = null;
    try {
        config = JSON.parse(await readFile(LOCALES_PATH, 'utf8'));
    } catch {
        console.warn(`No locales.json found at ${LOCALES_PATH} — building without hreflang tags.`);
    }

    for (const relPath of pages) {
        const outPath = await buildPage(relPath, partials, config);
        console.log(`built  ${path.relative(ROOT, outPath)}`);
    }

    console.log(`\nDone. ${pages.length} page(s) assembled from ${Object.keys(partials).length} partial(s).`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
