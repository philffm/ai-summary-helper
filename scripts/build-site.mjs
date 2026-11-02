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
    researcher: ['Read with the evidence in view', 'Research on memory and source evaluation points to a simple workflow: make the paper findable, test your understanding, and return to the original passage.'],
    feeds: ['Curate current information without losing the trail', 'A focused feed helps you choose what to read; source links, timestamps and a local archive keep the briefing inspectable.'],
    video: ['Turn more video into something you can use', 'Learning research supports meaningful segments, clear signals and active questions rather than passive replay.'],
    hoarder: ['Make saved reading returnable', 'Saving is only the first step. Retrieval, spacing and source context give an archive a reason to be revisited.'],
    privacy: ['A better reading workflow, backed by evidence', 'A local archive is useful when it helps you understand, check and revisit what you read — not merely collect more summaries.'],
    mcp: ['Connect tools without losing the boundary', 'Interoperability is useful when access is explicit, scoped and auditable. A protocol does not remove the need for least privilege or source review.']
};

function evidenceSection(persona) {
    const [title, intro] = EVIDENCE_COPY[persona] || EVIDENCE_COPY.privacy;
    const common = {
        retrieval: ['Retrieval beats rereading', 'Ask, don’t just reread', 'Testing yourself after reading often supports later retention better than studying the material again. Questions give a saved item a reason to be revisited.', 'Roediger & Karpicke (2006), Psychological Science 17(3), 249–255', 'https://doi.org/10.1111/j.1467-9280.2006.01693.x', 'student-library-desk-1600.webp'],
        source: ['Check the claim', 'Not just the citation', 'Source links make an answer easier to inspect, but a citation is not proof that the source supports the claim.', 'Correctness is not Faithfulness in RAG Attributions (2024)', 'https://arxiv.org/html/2412.18004v1', 'teacher-classroom-desk-1600.webp']
    };
    const slidesByPersona = {
        researcher: [
            ['Location over content', 'Keep the paper findable', 'When people expect to look something up later, they remember where to find information more than the information itself. A source-linked archive keeps that location useful.', 'Sparrow, Liu & Wegner (2011), Science 333(6043), 776–778', 'https://doi.org/10.1126/science.1207745', 'researcher-desk-notes-1600.webp'],
            ['Methods and limitations', 'Read beyond the abstract', 'A summary can help you navigate a paper, but methods, sample, confounders and limitations still need to be inspected in the original.', 'Supported interpretation from research-reading practice', 'https://www.nature.com/articles/d41586-018-01023-5', 'sticky-notes-desk-1600.webp'],
            common.retrieval,
            common.source
        ],
        feeds: [
            ['Choose the sources', 'A smaller reading list is easier to inspect', 'A focused set of sources makes it easier to compare reporting instead of treating every headline as equally useful.', 'Wineburg & McGrew (2019), lateral reading and source evaluation', 'https://doi.org/10.1177/016146811912101102', 'researcher-desk-notes-1600.webp'],
            ['Keep the trail', 'A briefing is not the original article', 'Source links and publication times let you return to the reporting behind a current summary. They do not prove that every claim is true.', 'Product implication based on source-evaluation research', 'https://doi.org/10.1177/016146811912101102', 'teacher-classroom-desk-1600.webp'],
            ['Compare before concluding', 'Agreement and disagreement both matter', 'Reading laterally means checking who is behind a claim and comparing it with other sources before drawing a conclusion.', 'Wineburg & McGrew (2019), lateral reading and source evaluation', 'https://doi.org/10.1177/016146811912101102', 'student-library-desk-1600.webp'],
            ['Keep current reading returnable', 'Local history adds context', 'A local archive preserves the articles you chose to read. Optional encrypted sync can keep that archive available across your devices without making the storage provider the owner of the content.', 'Product implication based on privacy-by-design guidance', 'https://www.nist.gov/privacy-framework/nist_privacy_framework_0', 'sticky-notes-desk-1600.webp']
        ],
        video: [
            ['Meaningful segments', 'Pause and process one idea', 'Learner-paced segmentation can improve retention and transfer, although it often increases the time needed to learn.', 'A meta-analysis of the segmenting effect (2019)', 'https://doi.org/10.1007/s10648-018-9456-4', 'student-library-desk-1600.webp'],
            ['Signal what matters', 'Make the important part visible', 'Signaling — cues that highlight essential content — supports multimedia learning when the cues are well designed.', 'A meta-analysis of signaling principle in multimedia learning (2020)', 'https://doi.org/10.1007/s11423-020-09748-7', 'teacher-classroom-desk-1600.webp'],
            common.retrieval,
            ['Return to the exact moment', 'Keep the timestamp with the claim', 'A transcript and timestamp make a video statement easier to find and inspect. They do not establish that the statement is true.', 'Product implication based on video-learning and source-evaluation research', 'https://doi.org/10.1007/s10758-024-09745-2', 'researcher-desk-notes-1600.webp']
        ],
        hoarder: [
            ['Location over content', 'Make saved reading findable', 'When people expect to look something up later, they remember where to find information more than the information itself.', 'Sparrow, Liu & Wegner (2011), Science 333(6043), 776–778', 'https://doi.org/10.1126/science.1207745', 'researcher-desk-notes-1600.webp'],
            ['Retrieval beats rereading', 'Return to the idea, not just the tab', 'Testing yourself after reading often supports later retention better than simply studying the material again.', 'Roediger & Karpicke (2006), Psychological Science 17(3), 249–255', 'https://doi.org/10.1111/j.1467-9280.2006.01693.x', 'student-library-desk-1600.webp'],
            ['Space the return', 'A library needs a return path', 'Spaced practice generally supports longer-term retention better than concentrating all study in one session.', 'Cepeda et al. (2006), Psychological Bulletin 132(3), 354–380', 'https://doi.org/10.1037/0033-2909.132.3.354', 'sticky-notes-desk-1600.webp'],
            common.source
        ],
        privacy: [
            ['Minimise the data', 'Collect and process only what is needed', 'Privacy-by-design guidance treats data minimisation and protective defaults as design requirements, not optional extras.', 'European Data Protection Board, data protection by design and by default (2026)', 'https://www.edpb.europa.eu/system/files/documents/2026-02/edpb-summary-gdpr-data-protection-design-default_en.pdf', 'researcher-desk-notes-1600.webp'],
            ['Local is a boundary', 'Less transmission, not zero risk', 'Local inference can reduce what is sent to a cloud provider, but device security, backups, models and sync still matter.', 'NIST Privacy Framework overview', 'https://www.nist.gov/privacy-framework/nist_privacy_framework_0', 'student-library-desk-1600.webp'],
            ['BYOK is a provider request', 'Your key does not make it local', 'With BYOK, the request and any included context go to the provider you chose. The archive and the request are separate data boundaries.', 'Supported interpretation from provider-boundary and privacy-by-design guidance', 'https://www.edpb.europa.eu/topics/key-gdpr-concepts/basic-principles_en', 'teacher-classroom-desk-1600.webp'],
            common.source
        ],
        mcp: [
            ['Least privilege', 'Give tools only the access they need', 'Security guidance for tool-connected AI systems recommends explicit scope, minimal permissions and careful handling of untrusted content.', 'NSA, MCP Security Guidance', 'https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf', 'researcher-desk-notes-1600.webp'],
            ['Explicit boundaries', 'Local context is not automatic trust', 'A protocol can make tools interoperable; it does not guarantee that a server, prompt or retrieved document is safe.', 'Model Context Protocol specification', 'https://modelcontextprotocol.io/specification/2025-03-26/server/prompts', 'teacher-classroom-desk-1600.webp'],
            ['Keep provenance', 'Every answer needs a route back', 'Source passages and clear retrieval boundaries make it easier to inspect what a connected tool used.', 'Correctness is not Faithfulness in RAG Attributions (2024)', 'https://arxiv.org/html/2412.18004v1', 'sticky-notes-desk-1600.webp'],
            ['Confirm external actions', 'Reading access is not write access', 'A safe integration should separate local retrieval from writes or external actions and ask for confirmation where the consequences change.', 'NSA, MCP Security Guidance', 'https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf', 'student-library-desk-1600.webp']
        ]
    };
    const slides = slidesByPersona[persona] || slidesByPersona.privacy;
    const total = slides.length + 1;
    return `<section class="landing-evidence"><div class="wrap"><div class="section-head center reveal"><div class="eyebrow">Why this workflow</div><h2>${title}</h2><p>${intro}</p></div><div class="cx cx--fit reveal" data-carousel role="region" aria-roledescription="carousel" aria-label="Evidence and live demo for this reading workflow"><ul class="cx-track">${slides.map(([big, heading, text, source, href, image], i) => `<li class="cx-slide${i === 0 ? ' is-active' : ''}" aria-roledescription="slide" aria-label="${i + 1} / ${total}"><figure><div class="cx-card" style="--img:url({{base}}assets/photo/${image})"><span class="cx-big cx-big--text">${big}</span><strong class="cx-title">${heading}</strong><span class="cx-text">${text}</span><small class="cx-src">Source: <a href="${href}" target="_blank" rel="noopener">${source}</a></small></div></figure></li>`).join('')}${landingDemoSlide(persona, slides.length)}</ul><button type="button" class="cx-nav cx-prev" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="cx-nav cx-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="cx-dots">${slides.map((_, i) => `<button type="button" class="cx-dot${i === 0 ? ' is-active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}<button type="button" class="cx-dot cx-dot--demo" aria-label="Go to live demo slide">Demo</button><button type="button" class="cx-dot cx-dot--demo-m" aria-label="Go to live demo slide">Demo</button></div></div></div></section>`;
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
    return `<figure class="landing-hero-video"><video muted autoplay loop playsinline controls preload="metadata" width="360" height="520" poster="{{base}}assets/blog/video/${clip}-en.jpg" aria-label="${label}"><source src="{{base}}assets/blog/video/${clip}-en.mp4" type="video/mp4"></video><figcaption>${label}</figcaption></figure>`;
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
