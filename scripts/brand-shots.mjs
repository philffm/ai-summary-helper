#!/usr/bin/env node
// scripts/brand-shots.mjs: the website's product screenshots in a brand, taken from the live demo (the real extension UI).
//
//   node plugin/scripts/build-demo.mjs            # the demo has to be built in the brand first (Kaivo by default)
//   node scripts/brand-shots.mjs [--only=posters,panels,inpage,wide,story]
//
// → brands/<id>/site/shots/*.webp and brands/<id>/site/demo-poster/<lang>-<theme>.webp (committed). The brand build lays
// brands/<id>/site/ over the copied assets/, so the file names stay those of the source site. docs/ is not touched.
// Needs Playwright from node_modules or videos/node_modules. Nothing is served on a port.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadBrand, brandIdFromArgs, REPO } from '../brands/index.mjs';

const args = process.argv.slice(2);
const brand = loadBrand(brandIdFromArgs(args.filter((a) => !a.startsWith('--only='))));
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') || ['posters', 'panels', 'inpage', 'wide', 'story'];
const OUT = path.join(brand.dir, 'site');
const DEMO = path.join(REPO, 'plugin/dist/demo');
if (!fs.readFileSync(path.join(DEMO, 'app/popup.html'), 'utf8').includes(brand.name)) throw new Error(`The demo is not built in ${brand.name}: node plugin/scripts/build-demo.mjs`);
const POSTER_LANGS = fs.readdirSync(path.join(REPO, 'docs/assets/demo-poster')).filter((f) => f.endsWith('-light.webp')).map((f) => f.slice(0, -11));

let pw;
for (const where of ['playwright', pathToFileURL(path.join(REPO, 'videos/node_modules/playwright/index.js')).href]) {
    try { pw = await import(where); break; } catch { /* try the next place */ }
}
if (!pw) throw new Error('Playwright is not installed (npm i --no-save playwright && npx playwright install chromium)');
const browser = await (pw.chromium || pw.default.chromium).launch();

const ORIGIN = 'http://demo.invalid';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
async function open(viewport, query, scale = 1) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const file = path.join(DEMO, decodeURIComponent(url.pathname));
        if (url.origin !== ORIGIN || !file.startsWith(DEMO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.abort();
        return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/index.html?tour=0&${query}`, { waitUntil: 'load' });
    const app = await (await page.waitForSelector('iframe#app')).contentFrame();
    await app.waitForSelector('.nav-item[data-screen=history]');
    await page.waitForTimeout(2200);
    return { context, page, app };
}
// Chromium encodes the WebP itself, so no image tool has to be installed.
async function save(page, name, png, width) {
    const webp = await page.evaluate(async ([b64, w]) => {
        const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
        const c = document.createElement('canvas'); c.width = w || img.width; c.height = Math.round(img.height * (c.width / img.width));
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', 0.86).split(',')[1];
    }, [png.toString('base64'), width || 0]);
    const file = path.join(OUT, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(webp, 'base64'));
    console.log(`  ✓ ${path.relative(REPO, file)}`);
}
// the dock switches screens; a UI still loading its translations can jump back, so it is pressed until it stays
async function screen(page, app, name) {
    for (let i = 0; i < 5; i++) {
        await app.click(`.nav-item[data-screen=${name}]`);
        await page.waitForTimeout(700);
        if (await app.$(`.nav-item[data-screen=${name}].active`)) break;
    }
    await page.waitForTimeout(900);
}

// 1 · The picture behind "Try it" (per language and theme)
if (only.includes('posters')) for (const lang of POSTER_LANGS) for (const theme of ['light', 'dark']) {
    const { context, page } = await open({ width: 1280, height: 720 }, `lang=${lang}&theme=${theme}`);
    await save(page, `demo-poster/${lang}-${theme}.webp`, await page.screenshot());
    await context.close();
}

// 2 · The side panel alone
if (only.includes('panels')) for (const lang of ['en', 'de', 'ja']) for (const name of ['main', 'feeds', 'history']) {
    const { context, page, app } = await open({ width: 420, height: 860 }, `lang=${lang}&theme=light&chrome=0`, 2);
    if (name !== 'main') await screen(page, app, name);
    await save(page, `shots/aish-panel-${name}-${lang}.webp`, await page.screenshot());
    await context.close();
}

// 3 · The panel next to an article: the summary, then a follow-up answer with its place in the text
if (only.includes('inpage')) for (const lang of ['en', 'de', 'es', 'fr', 'ja']) {
    const { context, page, app } = await open({ width: 1440, height: 900 }, `lang=${lang}&theme=light`);
    await app.click('#fetchSummary');
    await app.waitForSelector('.chat-suggest-chip', { timeout: 30000 });
    await page.waitForTimeout(2500);
    // the summary of the article on the left, opened from its card
    const title = await page.locator('h1:visible').first().innerText().catch(() => app.locator('.chat-suggest-chip').first().innerText());
    const ask = async () => {
        await app.locator('.chat-suggest-chip').nth(1).click();
        await app.waitForSelector('.chat-src', { timeout: 30000 });
        await page.waitForTimeout(2500);
        await app.locator('.chat-src').last().click();
        await page.waitForTimeout(1800);
        await save(page, `shots/aish-inpage-ask-${lang}.webp`, await page.screenshot());
    };
    await ask();
    await app.getByText(title.slice(0, 18)).first().click();
    await page.waitForTimeout(2000);
    const detail = await page.screenshot();
    await save(page, `shots/aish-inpage-detail-${lang}.webp`, detail);
    await save(page, `shots/aish-inpage-detail-${lang}-720.webp`, detail, 720);
    await context.close();
}

// 4 · The two wide pictures with a headline: split view, research mode
if (only.includes('wide')) {
    const tokens = JSON.parse(fs.readFileSync(path.join(REPO, 'design-system/dist/tokens.resolved.json'), 'utf8'))[brand.id].site;
    const font = (family, file) => `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(path.join(REPO, 'docs/assets/fonts', file)).toString('base64')}) format('woff2');font-weight:100 900}`;
    const framed = async (name, mode, badge, headline, text, shot) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const vars = Object.entries(tokens[mode]).map(([k, v]) => `${k}:${v.value}`).join(';');
        await page.setContent(`<meta charset="utf-8"><style>${font('Space Grotesk', 'space-grotesk-latin-wght-normal.woff2')}${font('Inter', 'inter-latin-wght-normal.woff2')}
:root{${vars}}*{margin:0;padding:0;box-sizing:border-box}
body{width:1280px;height:800px;overflow:hidden;position:relative;font-family:Inter;color:var(--text);background:radial-gradient(70% 90% at 0% 0%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 60%),var(--bg)}
.b{position:absolute;left:64px;top:52px;font-weight:600;font-size:13px;color:var(--accent-text);border:1px solid color-mix(in srgb, var(--accent-text) 45%, transparent);border-radius:999px;padding:6px 13px}
h1{position:absolute;left:64px;top:100px;width:560px;font:700 44px/1.12 'Space Grotesk';letter-spacing:-.025em}
p{position:absolute;left:700px;top:68px;width:500px;font-size:18px;line-height:28px;color:var(--text-muted)}
img{position:absolute;left:64px;top:252px;width:1152px;border-radius:18px;border:1px solid var(--border-medium);box-shadow:0 30px 70px color-mix(in srgb, var(--shadow-ink) 24%, transparent)}</style>
<div class="b">${badge}</div><h1>${headline}</h1><p>${text}</p><img src="data:image/png;base64,${shot.toString('base64')}">`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await save(page, `shots/${name}.webp`, await page.screenshot());
        await page.close();
    };
    let s = await open({ width: 1730, height: 900 }, 'lang=en&theme=light&chrome=0', 1.4);
    await screen(s.page, s.app, 'history');
    await s.app.click('.ws-seg [data-n="3"]');
    await s.page.waitForTimeout(4000);   // the graph settles
    await framed('aish-split-wide-en', 'light', 'Split view', 'Big screen? Three views at once.', `Open ${brand.name} in a tab or widen the side panel: list, graph and analytics side by side.`, await s.page.screenshot());
    await s.context.close();
    s = await open({ width: 1730, height: 900 }, 'lang=en&theme=dark&chrome=0&scenario=research', 1.4);
    await screen(s.page, s.app, 'history');
    await s.app.click('.history-tab[data-tab=collections]');
    await s.page.waitForTimeout(900);
    await s.app.click('.coll-card');
    await s.page.waitForTimeout(1800);
    await framed('aish-research-dark-en', 'dark', 'Research mode', 'In the dark, not clueless.', 'Research mode spots papers, pulls out design, sample and funding and checks every quote against the text. Collections keep all sources for one question side by side.', await s.page.screenshot());
    await s.context.close();
}
// 5 · The five pictures of the story landing page (/start/): "wide" is the article with the panel beside it, "tall" a phone-sized
//     close-up that stays readable at 350 px. The source tree gets a copy where it has none, so docs/ has no broken pictures.
if (only.includes('story')) for (const theme of ['light', 'dark']) {
    const store = async (page, state, shape, png, width) => {
        const name = `shots/story-${state}-${shape}-${theme}-en.webp`;
        await save(page, name, png, width);
        const source = path.join(REPO, 'docs/assets', name);
        if (!fs.existsSync(source)) fs.copyFileSync(path.join(OUT, name), source);
    };
    // draws rectangles of screenshots (2× pixels) onto one 840 px wide picture: [png index, sx, sy, sw, sh, top]
    const compose = async (page, pngs, parts, join) => Buffer.from(await page.evaluate(async ([list, rects, line]) => {
        const imgs = await Promise.all(list.map(async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return i; }));
        const c = document.createElement('canvas'); c.width = 840; c.height = 760;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        const probe = document.createElement('canvas').getContext('2d'); probe.drawImage(imgs[0], rects[0][1] + 4, rects[0][2] + 4, 1, 1, 0, 0, 1, 1);
        g.fillStyle = `rgb(${[...probe.getImageData(0, 0, 1, 1).data].slice(0, 3)})`; g.fillRect(0, 0, 840, 760);
        for (const [n, sx, sy, sw, sh, top] of rects) g.drawImage(imgs[n], sx, sy, sw, sh, 0, top, 840, Math.round(sh * 840 / sw));
        if (line) { g.strokeStyle = line[2]; g.lineWidth = 4; g.setLineDash([8, 8]); g.beginPath(); g.moveTo(420, line[0]); g.lineTo(420, line[1]); g.stroke(); }
        return c.toDataURL('image/png').split(',')[1];
    }, [pngs.map((p) => p.toString('base64')), parts, join || null]), 'base64');
    const summarize = async ({ page, app }) => { await app.click('#fetchSummary'); await app.waitForSelector('.chat-suggest-chip', { timeout: 30000 }); await page.waitForTimeout(2500); };
    const openDetail = async ({ page, app }) => { const title = await page.locator('h1:visible').first().innerText(); await app.getByText(title.slice(0, 18)).first().click(); await page.waitForTimeout(2000); };
    const openMenu = async ({ page, app }) => { await app.evaluate(() => [...document.querySelectorAll('.card-menu-btn')].find((e) => e.offsetParent && e.getBoundingClientRect().top > 80)?.click()); await page.waitForTimeout(1200); };

    // wide: article + panel
    let s = await open({ width: 900, height: 700 }, `lang=en&theme=${theme}`, 2);
    const read = await s.page.screenshot();
    await store(s.page, 'read', 'wide', read, 1440);
    await store(s.page, 'read', 'tall', await compose(s.page, [read], [[0, 30, 24, 920, 832, 0]]));
    await summarize(s);
    await s.app.locator('.chat-suggest-chip').nth(1).click();
    await s.app.waitForSelector('.chat-src', { timeout: 30000 });
    await s.page.waitForTimeout(2500);
    await s.app.locator('.chat-src').last().click();
    await s.page.waitForTimeout(1800);
    const ask = await s.page.screenshot();
    await store(s.page, 'source', 'wide', ask, 1440);
    // tall: the answer on top, the marked passage under it
    await store(s.page, 'source', 'tall', await compose(s.page, [ask], [[0, 992, 520, 776, 308, 40], [0, 30, 24, 920, 76, 464], [0, 30, 1140, 920, 172, 533]], [386, 452, theme === 'dark' ? '#6ec3cd' : '#0b525e']));
    await openDetail(s);
    await store(s.page, 'summary', 'wide', await s.page.screenshot(), 1440);
    await s.context.close();
    s = await open({ width: 900, height: 700 }, `lang=en&theme=${theme}`, 2);
    await screen(s.page, s.app, 'history');
    await store(s.page, 'keep', 'wide', await s.page.screenshot(), 1440);
    await openMenu(s);
    await store(s.page, 'take', 'wide', await s.page.screenshot(), 1440);
    await s.context.close();

    // tall: the panel alone
    s = await open({ width: 420, height: 620 }, `lang=en&theme=${theme}&chrome=0`, 2);
    await summarize(s);
    await s.app.getByText('The quiet comeback').first().click();
    await s.page.waitForTimeout(2000);
    await store(s.page, 'summary', 'tall', await compose(s.page, [await s.page.screenshot()], [[0, 0, 262, 840, 760, 0]]));
    await s.context.close();
    s = await open({ width: 420, height: 620 }, `lang=en&theme=${theme}&chrome=0`, 2);
    await screen(s.page, s.app, 'history');
    await store(s.page, 'keep', 'tall', await compose(s.page, [await s.page.screenshot()], [[0, 0, 100, 840, 760, 0]]));
    await openMenu(s);
    await store(s.page, 'take', 'tall', await compose(s.page, [await s.page.screenshot()], [[0, 0, 240, 840, 760, 0]]));
    await s.context.close();
}
await browser.close();
