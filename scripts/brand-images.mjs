#!/usr/bin/env node
// scripts/brand-images.mjs: draws the raster artwork of the blog (post images and the social preview) in a brand.
//
//   node scripts/brand-images.mjs            # Kaivo → brands/kaivo/site/**.webp (committed; run again after a text or colour change)
//   node scripts/brand-images.mjs --lang=de,ja   # only these languages (en = the default pictures)
//
// docs/ keeps the source brand's pictures. The brand build copies these over them (brands/<id>.json › assets.site), so
// `npm run site:build` needs no browser. This script does: it uses Playwright from node_modules or videos/node_modules.
// Colours come from the design tokens, fonts and icon from the repo. English pictures go to site/, every other language to
// site/i18n/<lang>/ with the texts of scripts/brand-images-i18n/*.json (the example article of the social preview: the
// website's docs/assets/hero-i18n.js). The brand build points each language's pages at its own pictures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBrand, brandIdFromArgs, REPO } from '../brands/index.mjs';

const brand = loadBrand(brandIdFromArgs(process.argv.slice(2)));
const OUT = path.join(brand.dir, 'site');
const tokens = JSON.parse(fs.readFileSync(path.join(REPO, 'design-system/dist/tokens.resolved.json'), 'utf8'))[brand.id]?.site;
if (!tokens) throw new Error(`No design tokens for "${brand.id}"`);
const vars = (mode) => Object.entries(tokens[mode]).map(([k, v]) => `${k}:${v.value}`).join(';');

const data = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(REPO, file)).toString('base64')}`;
const FONTS = [...fs.readFileSync(path.join(REPO, 'docs/assets/styles.css'), 'utf8').matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0])
    .map((face) => face.replace(/src:[^;]+;/, () => { const f = face.match(/url\('fonts\/([^']+)'\)/)[1]; return `src:url(${data(`docs/assets/fonts/${f}`, 'font/woff2')}) format('woff2');`; })).join('');
const ICON = data(path.relative(REPO, path.join(brand.dir, 'icons/icon.svg')), 'image/svg+xml');
const mix = (token, pct) => `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;

const EN = {
    send: 'Send', cta: 'Add to Chrome — free', tag: brand.tagline,
    p: ['Answers cite the page', 'Jump to the passage', 'Instant first answer', 'Stop anytime', 'Your own API key', 'PDFs too', 'Local models', 'Open source', 'Stored in your browser', 'Free extension', 'Daily &amp; weekly recaps', 'Listen as a podcast', 'Your own RSS feeds', 'Links to every source', 'Ghost Highlights', 'Ask about any passage', 'Saved per article'],
    c1: ['Every answer comes with its <em>receipt</em>', 'Who paid for it?', 'The city paid for the whole project: about three million euros, spread over three years.', '“…paid for the whole bridge project in 2019, about three million euros…”', 'Jump to passage', 'How long did it take?', 'Any delays?', 'Ask a follow-up…'],
    c2: ['Bring your <em>own key</em>.', 'Where does my text go?', 'To the provider you set up with your own key, or to a local model. You choose.', '“Your key is stored in your browser”', 'Open settings', 'Use a local model?', 'Which providers?', 'Ask about your setup…'],
    c3: ['Your feeds, in <em>one recap</em>', 'What changed this week?', 'Three stories matter: a new browser release, a study on sleep and memory, and a pricing change at your host.', '“From 14 articles across 6 of your feeds”', 'Open article', 'Only AI news', 'Make it a podcast', 'Ask about your feeds…'],
    c4: ['Highlight it. Then <em>ask about it</em>.', 'What were the risks?', 'The second review found three open risks: a budget overrun, a delayed permit and one unsigned contract.', '“…the second review found three open risks before the vote…”', 'Which is most urgent?', 'Who owns them?', 'Ask about your highlight…'],
    g: ['Information tied to <em>meaning and connection</em> outlasts information you just glanced at', 'Craik &amp; Lockhart, 1972 · Levels of Processing Theory', 'Connect the dots. Swipe →', 'Meat allergy is on t…', 'Rapid warming may ti…', 'The Dut…', 'Health', 'The Orwellian Compan…', 'Oceanography', 'Climate Change', 'Policy', 'Study links coffee c…', 'The Fedora 45 Sausag…', 'Neuroscience', 'Cognitive Sc…'],
    k: ['82% of people say <em>tab clutter</em> stresses them out.', 'Cure Overload. Swipe →'],
    r: ['Runtime parts and how they talk', 'Web page (any tab)', 'Extension', 'Static content script, about 6 KB. Wakes up for saved highlights or a text selection, nothing else.', 'About 200 KB bundle, injected on demand: text extraction, highlights, selection tooltip, summary run. Guarded against double injection.', 'Background worker', 'background.js + finalize.js. Streams model output, aiComplete / aiCancel, feed polling, audio, finishes a run whose page went away. Idle timeout only after the first chunk.', 'LLM provider', 'OpenAI-compatible, Ollama, or byphil Cloud. Called directly from the background worker.', 'Popup / side panel', 'popup.html + ES modules. Main screen first; Feeds, History and Settings load after the first paint.', 'sync: settings and flags · local: library index, article records, highlights, providers, feeds'],
    s: ['Storage (StorageManager, keys in storageKeys.js)', 'Area', 'Where', 'Notes', 'Settings, flags, language, theme', 'small values only', 'Library index', 'lean list, never holds article text', 'Article record', 'Highlights', 'one array for all pages, matched by pageKeyForUrl', 'Providers and keys', 'per service: key, model, endpoint', 'Feeds', 'subscriptions, items, recaps, UI state'],
    e: ['A summary, end to end', 'Ask', 'The popup tells the content script to summarize. If it is not in the page yet, the background injects it first.', 'Stream', 'The content script extracts the text. The background streams the provider answer back as progress.', 'Finalize', 'finalizeSummary builds clean HTML plus tags, ghost highlights, mood, paper verdict and follow-up questions with a short answer each.', 'Save', 'articles:index gets a lean entry, a separate record holds the text. summaryComplete is relayed to the popup.', 'Follow up', 'A chip types its short answer like a person while the model continues it. Thinking more… with Stop covers the wait.'],
    h: ['Any page, summed up in your language.', 'Use your own key or a local model. Nothing leaves your device unless you choose.', 'Own key or local', 'Open source', 'No account', 'SUMMARIZE IN', 'Your questions'],
};
const EN_STORY = {
    url: 'dailyledger.example/work-life/office-fern', mast: 'The Daily Ledger', kick: 'WORK &amp; LIFE', h: 'Office fern outlives four reorganisations, now up for team lead', dek: 'Colleagues praise the plant’s “remarkable resilience”.', p1: 'Leeds. When the logistics team moved floors, nobody expected Gerald to survive.', hl: 'Seven years and four reorganisations later, the office fern is the longest-serving member.', badge: 'Runs locally · gemma3:4b', sumLabel: 'AI Summary', tags: ['workplace', 'humour', 'management'], tabs: ['Feeds', 'Summarize', 'History'], graphT: 'Your knowledge graph', graphL: '2h 48m saved <span style="color:var(--text);margin-left:10px">11 day streak</span>',
    A: { t: 'A fern climbs the career ladder', b: 'Gerald, an office fern in Leeds, has outlasted <strong>four reorganisations in seven years</strong> and is now up for team lead.', p: ['87% of staff call him the most reliable presence in the office.', 'A rival succulent in accounts has filed a complaint.'], q: 'Why is Gerald up for promotion?', a: 'Staff see him as the most reliable presence in the office. Management says he listens and grows.' },
};
const I18N = Object.assign({}, ...fs.readdirSync(path.join(REPO, 'scripts/brand-images-i18n')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/brand-images-i18n', f), 'utf8'))));
const heroWindow = {};
new Function('window', fs.readFileSync(path.join(REPO, 'docs/assets/hero-i18n.js'), 'utf8'))(heroWindow);
let LANG = 'en', T = EN, STORY = EN_STORY;
// Every translation must have exactly the shape of the English texts: a missing line would silently stay English.
function useLanguage(lang) {
    LANG = lang;
    if (lang === 'en') { T = EN; STORY = EN_STORY; return; }
    T = I18N[lang];
    if (!T) throw new Error(`No texts for "${lang}" in scripts/brand-images-i18n/`);
    for (const [k, v] of Object.entries(EN)) if (Array.isArray(v) ? T[k]?.length !== v.length : !T[k]) throw new Error(`${lang}: "${k}" needs ${Array.isArray(v) ? v.length + ' texts, has ' + (T[k]?.length ?? 0) : 'a text'}`);
    const h = heroWindow.AISH_HERO_I18N[lang];
    if (!h) throw new Error(`${lang}: no example article in docs/assets/hero-i18n.js`);
    STORY = { ...h, A: { ...h.A, p: [h.A.p] }, graphL: h.graphL };
}
// Text that must not leave its box: [data-fit] is scaled down until it fits its parent.
const FIT = () => {
    for (const el of document.querySelectorAll('[data-fit]')) {
        const box = el.parentElement;
        const over = () => el.getBoundingClientRect().height > box.clientHeight + 1 || [el, ...el.querySelectorAll('h1,h3,p,span,td,th,div,blockquote')].some((n) => n.clientWidth && n.scrollWidth > n.clientWidth + 1);
        for (let z = 1; z >= 0.5 && over(); z -= 0.02) el.style.zoom = z;
    }
};

const page = (mode, css, body) => `<!doctype html><html lang="${LANG}"><meta charset="utf-8"><style>${FONTS}
:root{${vars(mode)}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,sans-serif;color:var(--text);background:var(--bg);overflow:hidden;position:relative}
h1,h2,h3{font-family:'Space Grotesk',sans-serif;letter-spacing:-.025em}
em{font-style:normal;color:var(--accent-text)}
.abs{position:absolute}
.fit{position:absolute;overflow:hidden}
:lang(ja) h1,:lang(zh) h1,:lang(zh-tw) h1,:lang(ko) h1{letter-spacing:0;line-height:1.3;word-break:keep-all;line-break:strict}
:lang(ja) h1,:lang(zh) h1,:lang(zh-tw) h1{word-break:normal}
:lang(th) h1,:lang(hi) h1,:lang(ar) h1,:lang(vi) h1{letter-spacing:0;line-height:1.35}
:lang(ar) :is(h1,h2,h3,p,blockquote,table,.a,.q,.src,.sum,.ans){direction:rtl;text-align:right}
:lang(ar) p.swipe{text-align:center}
${css}</style>${body}`;

// ── Post covers with an example conversation (800 × 1000) ───────────────
const DARK_BG = `body{width:800px;height:1000px;background:radial-gradient(120% 70% at 18% 0%, ${mix('--accent', 34)}, transparent 62%),var(--bg)}`;
const chrome = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M21.2 8H12M3.9 6.9 8.5 14M10.9 21.9 15.5 14"/></svg>';

const answerCover = (d) => page('dark', `${DARK_BG}
.title{left:62px;top:${d.top ? d.top : 74}px;width:372px;height:${d.top ? 330 : 475}px;display:flex;flex-direction:column;justify-content:${d.top ? 'flex-start' : 'center'}}
h1{font-size:60px;line-height:1.16}
h1 span{display:block;white-space:nowrap}
.panel{position:absolute;left:441px;top:74px;width:299px;height:475px;border:1.5px solid var(--border-strong);border-radius:22px;background:var(--bg-raised);overflow:hidden;font-size:13px;line-height:1.45}
.ph{height:46px;display:flex;align-items:center;gap:9px;padding:0 14px;border-bottom:1px solid var(--border-medium);font-weight:600}
.ph img{width:24px;height:24px}
.talk{position:absolute;left:13px;right:14px;top:64px;height:${d.top ? 296 : 270}px}
.talk>div{display:flex;flex-direction:column;gap:14px}
.q{align-self:flex-end;max-width:100%;padding:8px 13px;border-radius:14px 14px 4px 14px;background:var(--accent-fill);color:var(--on-accent);font-weight:600}
.a{background:var(--surface-1-strong);border-radius:14px 14px 14px 4px;padding:13px;display:grid;gap:10px}
.a blockquote{border-left:2.5px solid var(--highlight);padding-left:9px;font-size:11px;color:var(--text-muted)}
.a b{justify-self:start;font-size:11px;font-weight:600;color:var(--accent-text);border:1px solid ${mix('--accent-text', 55)};border-radius:999px;padding:5px 11px}
.sugg{position:absolute;left:13px;right:10px;bottom:${475 - 396}px;display:flex;gap:8px;flex-wrap:wrap}
.sugg span{border:1px solid var(--border-strong);border-radius:999px;padding:5px 11px;font-size:10.5px}
.in{position:absolute;left:13px;right:14px;top:407px;height:42px;border:1px solid var(--border-strong);border-radius:999px;display:flex;align-items:center;justify-content:space-between;padding:0 5px 0 15px;color:var(--text-muted);font-size:12px;white-space:nowrap}
.in span{overflow:hidden;text-overflow:ellipsis}
.in b{background:var(--accent-fill);color:var(--on-accent);border-radius:999px;padding:6px 16px;font-size:11.5px}
.pillbox{left:0;right:0;top:648px;height:130px}
.pills{display:grid;gap:16px;padding:0 14px}
.pills div{display:flex;justify-content:center;gap:14px}
.pills span{display:flex;align-items:center;gap:9px;height:52px;padding:0 15px;border:1.5px solid var(--border-medium);border-radius:11px;font-size:20.5px;letter-spacing:-.02em;white-space:nowrap}
.pills span::before{content:"";width:11px;height:11px;border-radius:50%;background:var(--accent-text)}
.footbox{left:48px;right:38px;top:885px;height:80px}
.foot{height:68px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.id{display:grid;grid-template-columns:52px auto;column-gap:14px;align-items:center}
.id img{grid-row:span 2;width:52px;height:52px}
.id strong{font:700 30px/1.1 'Space Grotesk';letter-spacing:-.02em}
.id small{font-size:14px;color:var(--text-muted)}
.cta{display:flex;align-items:center;gap:12px;height:66px;padding:0 28px;border-radius:15px;background:var(--accent-fill);color:var(--on-accent);font-weight:700;font-size:20px;white-space:nowrap}`,
    `<div class="fit title"><div data-fit><h1>${Array.isArray(d.title) ? d.title.map((l) => `<span>${l}</span>`).join('') : d.title}</h1></div></div>
<div class="panel"><div class="ph"><img src="${ICON}">${brand.name}</div><div class="talk"><div data-fit><div class="q">${d.q}</div>
<div class="a"><span>${d.a}</span><blockquote>${d.quote}</blockquote><b>↗ ${d.action}</b></div></div></div>
<div class="sugg">${d.sugg.map((s) => `<span>${s}</span>`).join('')}</div><div class="in"><span>${d.placeholder}</span><b>${T.send}</b></div></div>
<div class="fit pillbox"><div class="pills" data-fit>${d.pills.map((row) => `<div>${row.map((p) => `<span>${p}</span>`).join('')}</div>`).join('')}</div></div>
<div class="fit footbox"><div class="foot" data-fit><div class="id"><img src="${ICON}"><strong>${brand.name}</strong><small>${T.tag}</small></div><div class="cta">${chrome}${T.cta}</div></div></div>`);

// English keeps its hand-set line breaks; translations wrap on their own and are scaled to fit.
const EN_LINES = { c1: [126, ['Every', 'answer', 'comes with', 'its <em>receipt</em>']], c2: [212, ['Bring your', '<em>own key</em>.']], c3: [212, ['Your feeds,', 'in <em>one recap</em>']], c4: [169, ['Highlight it.', 'Then <em>ask</em>', '<em>about it</em>.']] };
const cover = (k, pills) => {
    const x = T[k], en = LANG === 'en', four = k === 'c4';
    const [title, q, a, quote] = x, action = four ? T.c1[4] : x[4], sugg = four ? [x[4], x[5]] : [x[5], x[6]], placeholder = four ? x[6] : x[7];
    return answerCover({ top: en ? EN_LINES[k][0] : 0, title: en ? EN_LINES[k][1] : title, q, a, quote, action, sugg, placeholder, pills: pills.map((row) => row.map((i) => T.p[i])) });
};
const COVERS = {
    'answer-with-receipt': () => cover('c1', [[0, 1, 2], [3, 4, 5]]),
    'bring-your-own-key': () => cover('c2', [[4, 6, 7], [8, 9, 3]]),
    'feeds-recap': () => cover('c3', [[10, 11, 12], [13, 4, 3]]),
    'highlight-then-ask': () => cover('c4', [[14, 15, 0], [16, 4, 5]]),
};

// ── Two quote covers ─────────────────────────────────────────────────────
const QUOTE_CSS = `${DARK_BG}
.head{left:74px;right:60px;height:520px}
h1{line-height:1.18}
.src{margin-top:40px;padding-right:60px;color:var(--text-muted);font-size:24px;line-height:1.45}
.swipe{position:absolute;left:0;right:0;text-align:center;font-size:26px}`;

function graphCover() {
    const node = (x, y, r, tone) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(${tone})" stroke="var(--text)" stroke-width="2.5"/>`;
    // translated labels differ in length: near an edge they hang from that edge instead of being centred on their node
    const edge = (x) => (LANG === 'en' ? [x, 'middle'] : x < 160 ? [14, 'start'] : x > 640 ? [786, 'end'] : [x, 'middle']);
    const text = (x, y, s, tone = '--text-muted', w = 500) => { const [at, anchor] = edge(x); return `<text x="${at}" y="${y}" text-anchor="${anchor}" direction="ltr" style="unicode-bidi:plaintext" fill="var(${tone})" font-size="${w > 500 ? 26 : 21}" font-weight="${w}">${s}</text>`; };
    const edges = [[30, 725, 140, 858], [30, 725, 279, 691], [279, 691, 356, 773], [356, 773, 471, 809], [356, 773, 281, 897], [575, 710, 660, 774], [660, 774, 752, 877], [356, 773, 575, 710], [140, 858, 281, 897], [226, 575, 356, 773], [600, 496, 575, 710], [10, 586, 30, 725], [471, 809, 660, 774]];
    return page('dark', `${QUOTE_CSS} .head{top:82px} h1{font-size:66px}
svg{position:absolute;inset:0} .fade{position:absolute;left:0;right:0;top:0;height:760px;background:linear-gradient(var(--bg) 66%, transparent)}`,
    `<svg viewBox="0 0 800 1000" width="800" height="1000" font-family="Inter">
${edges.map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="var(--text-muted)" stroke-opacity=".28"/>`).join('')}
${node(600, 496, 19, '--accent')}${node(226, 575, 18, '--accent')}${node(10, 586, 17, '--accent')}${node(30, 725, 27, '--accent-fill')}${node(279, 691, 19, '--accent')}${node(575, 710, 16, '--accent')}${node(660, 774, 17, '--highlight')}${node(356, 773, 19, '--highlight')}${node(471, 809, 19, '--accent-text')}${node(140, 858, 20, '--accent-text')}${node(281, 897, 17, '--accent')}${node(752, 877, 16, '--accent-fill')}
${text(600, 470, T.g[3])}${text(226, 546, T.g[4])}${text(765, 545, T.g[5])}${text(44, 687, T.g[6], '--accent-text', 700)}${text(279, 664, T.g[7])}${text(575, 686, T.g[8], '--accent-text', 700)}${text(357, 744, T.g[9], '--highlight-text', 700)}${text(660, 748, T.g[10], '--highlight-text', 700)}${text(505, 840, T.g[11])}${text(140, 831, T.g[12])}${text(282, 871, T.g[13], '--accent-text', 700)}${text(722, 852, T.g[14], '--accent-text', 700)}
</svg><div class="fade"></div>
<div class="fit head"><div data-fit><h1>${LANG === 'en' ? 'Information tied to<br><em>meaning and<br>connection</em> outlasts<br>information you just<br>glanced at' : T.g[0]}</h1>
<p class="src">${T.g[1]}</p></div></div>
<p class="swipe" style="top:908px">${T.g[2]}</p>`);
}

// The browser bar is a photo of a real tab strip without any brand in it: it is cut out of the original cover.
const clutterCover = () => page('dark', `${QUOTE_CSS} .head{top:76px} h1{font-size:77px} .src{margin-top:36px;font-size:21px;padding:0}
.bar{position:absolute;left:33px;top:614px;width:780px;height:151px;border-radius:24px;overflow:hidden;border:1px solid var(--border-strong)}
.bar img{position:absolute;left:-34px;top:-615px;width:800px}`,
`<div class="fit head"><div data-fit><h1>${LANG === 'en' ? '82% of people<br>say <em>tab clutter</em><br>stresses them<br>out.' : T.k[0]}</h1><p class="src">Ma et al., 2023 (ACM CHI: When Browsing Gets Cluttered)</p></div></div>
<div class="bar"><img src="${data('docs/assets/blog/tab-clutter.webp', 'image/webp')}"></div><p class="swipe" style="top:908px">${T.k[1]}</p>`);

// ── Diagrams of the architecture post (light) ────────────────────────────
const DIAGRAM_CSS = (w, h) => `body{width:${w}px;height:${h}px}
h2{position:absolute;left:30px;top:21px;font-size:22px}
.card{position:absolute;background:var(--bg-raised);border:1.5px solid var(--border-medium);border-radius:14px;overflow:hidden}
.card>div{padding:14px 15px}
.card h3{font-size:17px;margin-bottom:12px}
.card p{font-size:13.2px;line-height:17px;color:var(--text-muted)}
.card.hi{background:${mix('--accent-text', 10)};border-color:var(--accent-text)}
.lbl{position:absolute;font:500 12px 'JetBrains Mono';color:var(--accent-text);white-space:nowrap}
svg{position:absolute;inset:0}`;
const card = (x, y, w, h, title, text, hi) => `<div class="card${hi ? ' hi' : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><div data-fit><h3>${title}</h3><p>${text}</p></div></div>`;
const label = (x, y, s) => `<span class="lbl" style="left:${x}px;top:${y}px">${s}</span>`;
const arrows = (w, h, paths) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke="var(--accent-text)" stroke-width="1.8"><defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--accent-text)" stroke="none"/></marker></defs>${paths}</svg>`;

const runtime = () => page('light', `${DIAGRAM_CSS(1760, 620)}
.zone{position:absolute;top:70px;height:500px;border:1.5px dashed var(--text-muted);border-radius:16px;background:${mix('--accent-text', 5)};padding:15px;font-weight:600;font-size:14px;color:var(--text-muted)}`,
`<h2>${T.r[0]}</h2><div class="zone" style="left:40px;width:380px">${T.r[1]}</div><div class="zone" style="left:520px;width:780px">${T.r[2]}</div>
${card(71, 121, 318, 108, 'loader.js', T.r[3])}
${card(71, 281, 318, 148, 'content.js', T.r[4])}
${card(961, 121, 308, 198, T.r[5], T.r[6])}
${card(1441, 151, 258, 148, T.r[7], T.r[8])}
${card(551, 346, 318, 113, T.r[9], T.r[10])}
${card(551, 481, 718, 69, 'chrome.storage', T.r[11], true)}
${arrows(1760, 620, '<path d="M390 165H960" marker-end="url(#m)"/><path d="M390 300H960" marker-start="url(#m)" marker-end="url(#m)"/><path d="M550 402H390" marker-end="url(#m)"/><path d="M1115 320V402H870" marker-end="url(#m)"/><path d="M1270 225H1440" marker-end="url(#m)"/>')}
${label(560, 141, 'aish:injectContent')}${label(520, 307, 'executeScript ⇄ streamFetch')}${label(395, 379, 'summarize · ping')}${label(880, 411, 'summaryComplete · progress')}${label(1330, 197, 'stream')}`);

const storage = () => page('light', `${DIAGRAM_CSS(1760, 300)}
.tbl{left:30px;top:64px;width:1700px;height:230px}
table{width:100%;border-collapse:collapse;font-size:13.2px;table-layout:fixed}
th,td{height:32px;text-align:left;padding:0 14px;overflow:hidden;white-space:nowrap}
th{background:${mix('--accent-text', 12)};height:30px}
:lang(ar) :is(th,td){text-align:right}
tr:nth-child(odd) td{background:var(--bg-raised)}
td+td{font:500 12.5px 'JetBrains Mono';color:var(--accent-text);direction:ltr} td+td+td{font:400 13.2px Inter;color:var(--text-muted)}
:lang(ar) td+td+td{direction:rtl}`,
`<h2>${T.s[0]}</h2><div class="fit tbl"><table data-fit><colgroup><col style="width:506px"><col style="width:440px"><col></colgroup><tr><th>${T.s[1]}</th><th>${T.s[2]}</th><th>${T.s[3]}</th></tr>
${[[T.s[4], 'sync', T.s[5]], [T.s[6], 'local · articles:index', T.s[7]], [T.s[8], 'local · articles:rec:&lt;id&gt;', 'content, summary, conversation, suggested, suggestedAnswers'], [T.s[9], 'local · hl:all', T.s[10]], [T.s[11], 'local · config:services', T.s[12]], [T.s[13], 'local · feeds:*', T.s[14]]].map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`);

const endToEnd = () => page('light', `${DIAGRAM_CSS(1760, 250)} .card h3{margin-bottom:10px} h3 i{font-style:normal;margin-inline-end:12px} .card.hi h3{color:var(--accent-text)}`,
`<h2>${T.e[0]}</h2>
${[0, 1, 2, 3, 4].map((i) => card(31 + i * 346, 71, 315, 148, `<i>${i + 1}</i>${T.e[1 + i * 2]}`, T.e[2 + i * 2], i === 4)).join('')}
${arrows(1760, 250, [0, 1, 2, 3].map((i) => `<path d="M${351 + i * 346} 145H${373 + i * 346}" marker-end="url(#m)"/>`).join(''))}`);

// ── Social preview (1280 × 800) ──────────────────────────────────────────
// The language of the picture comes first in "Summarize in".
const NATIVE = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', ja: '日本語', ko: '한국어', pt: 'Português', it: 'Italiano', nl: 'Nederlands', pl: 'Polski', ru: 'Русский', uk: 'Українська', tr: 'Türkçe', id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ไทย', hi: 'हिन्दी', ar: 'العربية', sv: 'Svenska', da: 'Dansk', no: 'Norsk', fi: 'Suomi', zh: '简体中文', 'zh-tw': '繁體中文' };
const previewLanguages = () => [...new Set([NATIVE[LANG], 'English', 'Deutsch', 'Français', 'Español', '日本語'])].slice(0, 5).concat('+36');
const hero = () => page('light', `body{width:1280px;height:800px;background:radial-gradient(80% 90% at 0% 100%, ${mix('--accent', 14)}, transparent 60%),var(--bg)}
.logo{left:72px;top:68px;display:flex;align-items:center;gap:13px;font:700 28px 'Space Grotesk'} .logo img{width:52px;height:52px}
.intro{left:72px;top:208px;width:476px;height:440px}
h1{font-size:55px;line-height:1.1}
.sub{margin-top:18px;width:420px;font-size:20px;line-height:29px;color:var(--text-muted)}
.chips{margin-top:28px;display:flex;flex-wrap:wrap;gap:9px} .chips span,.langs span{border:1px solid var(--border-medium);border-radius:999px;background:var(--bg-raised);padding:8px 14px;font-size:14px;font-weight:500}
.cap{left:72px;top:676px;font:600 12px 'JetBrains Mono';letter-spacing:.08em;color:var(--text-muted)}
.langs{left:72px;top:699px;display:flex;gap:5px} .langs span{font-size:12.5px;padding:5px 9px;white-space:nowrap} .langs span:first-child,.on{background:var(--accent-fill)!important;color:var(--on-accent);border-color:transparent!important}
.box{position:absolute;background:var(--bg-raised);border:1px solid var(--border-medium);box-shadow:0 18px 50px ${mix('--shadow-ink', 14)}}
.win{left:561px;top:111px;width:598px;height:638px;border-radius:16px}
.url{left:638px;top:124px;width:520px;background:var(--bg-sunken);border-radius:8px;padding:5px 12px;font:500 12px 'JetBrains Mono';color:var(--text-muted)}
.dot{left:577px;top:131px;width:11px;height:11px;border-radius:50%;background:var(--border-strong);box-shadow:18px 0 var(--border-strong),36px 0 var(--border-strong)}
.artbox{left:597px;top:180px;width:262px;height:430px}
.art{font:17px/23px Georgia,serif}
.art h2{font:700 25px/32px Georgia,serif;margin:36px 0 16px} .art p{margin-bottom:13px} .art .k{font:700 12px Inter;color:var(--danger);letter-spacing:.05em;margin-top:26px} .art .k+h2{margin-top:8px}
.art mark{display:block;background:${mix('--highlight', 22)};color:inherit;padding:3px 5px}
.runs{left:640px;top:67px;border-radius:12px;padding:9px 14px;font-weight:600;font-size:15px;transform:rotate(2deg)} .runs::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent-text);margin-right:8px}
.panel{left:870px;top:57px;width:369px;height:667px;border-radius:24px;padding:17px;font-size:14px;line-height:19px}
.body{height:550px;overflow:hidden}
.head{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;height:26px} .head img{width:26px;height:26px}
.panel h3{font-size:15px;line-height:20px;margin:14px 0 10px} .meta{color:var(--accent-text);font-size:12px} .tags{display:flex;gap:8px;margin:12px 0 14px} .tags span{background:${mix('--accent-text', 10)};color:var(--accent-text);border-radius:8px;padding:3px 9px;font-size:12px}
.sum{border-left:3px solid var(--accent-text);background:${mix('--accent-text', 9)};border-radius:12px;padding:13px 15px} .sum small{font-weight:600;color:var(--text-muted);font-size:12px} .sum h4{font:700 19px/24px 'Space Grotesk';margin:8px 0 10px} .sum ul{padding-left:16px;margin-top:10px} .sum li{margin-top:6px}
.qh{margin:11px 0 7px;font-weight:600;font-size:13px;color:var(--text-muted)} .q{margin-left:auto;width:max-content;max-width:100%;background:var(--accent-fill);color:var(--on-accent);border-radius:999px;padding:7px 13px;font-weight:600;font-size:13px}
.ans{margin-top:9px;width:310px;border:1px solid var(--border-medium);border-radius:14px;padding:10px 14px}
.tabs{position:absolute;left:17px;right:17px;bottom:18px;display:flex;border:1px solid var(--border-medium);border-radius:16px;padding:5px;font-weight:600;font-size:11px;text-align:center} .tabs span{flex:1;border-radius:10px;padding:7px 0}
.graph{left:592px;top:620px;width:229px;height:170px;border-radius:14px;transform:rotate(3deg);padding:12px 14px;font-weight:600;font-size:12px}`,
`<div class="abs logo"><img src="${ICON}">${brand.name}</div>
<div class="fit intro"><div data-fit><h1>${LANG === 'en' ? 'Any page,<br>summed up in<br>your language.' : T.h[0]}</h1>
<p class="sub">${T.h[1]}</p><div class="chips"><span>${T.h[2]}</span><span>${T.h[3]}</span><span>${T.h[4]}</span></div></div></div>
<div class="abs cap">${T.h[5]}</div><div class="abs langs">${previewLanguages().map((l) => `<span>${l}</span>`).join('')}</div>
<div class="box win"></div><div class="abs dot"></div><div class="abs url">${STORY.url}</div>
<div class="fit artbox"><div class="art" data-fit><div style="font:700 21px Georgia">${STORY.mast}</div><p class="k">${STORY.kick}</p><h2>${STORY.h}</h2><p>${STORY.dek}</p><p>${STORY.p1}</p><mark>${STORY.hl}</mark></div></div>
<div class="box runs">${STORY.badge}</div>
<div class="box panel"><div class="head"><img src="${ICON}">${brand.name}</div><div class="body"><div data-fit><h3>${STORY.h} | ${STORY.mast}</h3><div class="meta">${STORY.url.split('/')[0]} · gemma3:4b</div>
<div class="tags">${STORY.tags.map((t) => `<span>${t}</span>`).join('')}<span>${LANG}</span></div>
<div class="sum"><small>${STORY.sumLabel.replace(/^✨\s*/, '')}</small><h4>${STORY.A.t}</h4>${STORY.A.b}<ul>${STORY.A.p.map((x) => `<li>${x}</li>`).join('')}</ul></div>
<div class="qh">${T.h[6]}</div><div class="q">${STORY.A.q}</div><div class="ans">${STORY.A.a}</div></div></div>
<div class="tabs"><span>${STORY.tabs[0]}</span><span class="on">${STORY.tabs[1]}</span><span>${STORY.tabs[2]}</span></div></div>
<div class="box graph">${STORY.graphT.replace(/^🕸\s*/, '')}<svg viewBox="0 0 200 90" width="200" height="90" style="display:block;margin-top:8px" font-size="10" font-family="Inter"><g stroke="var(--text-muted)" stroke-opacity=".4"><path d="M96 38 30 22M96 38 62 18M96 38 152 30M96 38 40 56M96 38 118 58M96 38 136 78M96 38 78 80M40 56 136 78M118 58 172 62" fill="none"/></g><g fill="var(--accent-text)"><circle cx="30" cy="22" r="3"/><circle cx="62" cy="18" r="3"/><circle cx="40" cy="56" r="4"/><circle cx="118" cy="58" r="3"/><circle cx="136" cy="78" r="3"/><circle cx="78" cy="80" r="3"/><circle cx="172" cy="62" r="3"/><circle cx="96" cy="38" r="5.5"/><circle cx="152" cy="30" r="3"/></g><g fill="var(--text)" font-weight="600"><text x="82" y="26">reading</text><text x="140" y="20">sources</text><text x="16" y="46">local-ai</text><text x="122" y="70">privacy</text></g></svg><div style="margin-top:8px;color:var(--accent-text)">${STORY.graphL.replace('🔥', '')}</div></div>`);

const images = () => [
    ...Object.entries(COVERS).map(([name, draw]) => [`blog/${name}.webp`, 800, 1000, draw()]),
    ['blog/knowledge-graph.webp', 800, 1000, graphCover()],
    ['blog/tab-clutter.webp', 800, 1000, clutterCover()],
    ['blog/runtime-parts.webp', 1760, 620, runtime()],
    ['blog/storage-map.webp', 1760, 300, storage()],
    ['blog/summary-end-to-end.webp', 1760, 250, endToEnd()],
    ['shots/aish-hero-en.webp', 1280, 800, hero()],
];
const asked = process.argv.find((a) => a.startsWith('--lang='))?.slice(7).split(',');
const languages = asked || ['en', ...Object.keys(I18N).sort()];
for (const lang of languages) useLanguage(lang);   // fail before drawing anything if a text is missing

let pw;
for (const where of ['playwright', pathToFileURL(path.join(REPO, 'videos/node_modules/playwright/index.js')).href]) {
    try { pw = await import(where); break; } catch { /* try the next place */ }
}
if (!pw) throw new Error('Playwright is not installed (npm i --no-save playwright && npx playwright install chromium)');
const browser = await (pw.chromium || pw.default.chromium).launch();
const tab = await browser.newPage();
for (const lang of languages) {
  useLanguage(lang);
  const dir = lang === 'en' ? OUT : path.join(OUT, 'i18n', lang);
  let bytes = 0;
  for (const [file, width, height, html] of images()) {
    await tab.setViewportSize({ width, height });
    await tab.setContent(html, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);
    await tab.evaluate(FIT);
    const png = await tab.screenshot();
    // Chromium encodes the WebP itself, so no image tool has to be installed.
    const webp = await tab.evaluate(async (b64) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/webp', 0.9).split(',')[1];
    }, png.toString('base64'));
    const out = path.join(dir, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(webp, 'base64'));
    bytes += fs.statSync(out).size;
  }
  console.log(`  ✓ ${lang}: ${path.relative(REPO, dir)}/ (${Math.round(bytes / 1024)} KB)`);
}
await browser.close();
