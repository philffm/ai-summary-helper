// App icons for the Android and iOS apps from brands/kaivo/icons/icon.svg.
//   node mobile/scripts/app-icons.mjs [android] [ios]        (default: both)
// Needs Playwright with a Chromium: `npm i --no-save playwright && npx playwright install chromium`, or the copy in videos/.
// PLAYWRIGHT_FROM=<dir with node_modules> and CHROME_PATH=<browser> override both.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function loadPlaywright() {
    for (const dir of [process.env.PLAYWRIGHT_FROM, REPO, path.join(REPO, 'videos')].filter(Boolean)) {
        try { return createRequire(path.join(dir, 'package.json'))('playwright'); } catch (_) { /* next */ }
    }
    throw new Error('Playwright not found: npm i --no-save playwright && npx playwright install chromium');
}
// the headless browser that ships with Remotion in videos/, if it is there
function bundledChrome(dir = path.join(REPO, 'videos', 'node_modules', '.remotion', 'chrome-headless-shell')) {
    if (!fs.existsSync(dir)) return undefined;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { const found = bundledChrome(p); if (found) return found; } else if (e.name === 'chrome-headless-shell') return p;
    }
    return undefined;
}

const targets = process.argv.slice(2);
const want = (t) => !targets.length || targets.includes(t);
const svg = fs.readFileSync(path.join(REPO, 'brands', 'kaivo', 'icons', 'icon.svg'), 'utf8');
const glyph = svg.match(/<g [\s\S]*<\/g>/)[0];
const BG = svg.match(/<rect [^>]*fill="(#[0-9A-Fa-f]{6})"/)[1];

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || bundledChrome() });
const page = await browser.newPage();
await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${glyph}</svg>`);
// the glyph's box including its stroke, in the 128 grid, so it can be centred exactly
const box = await page.evaluate(() => {
    const g = document.querySelector('g'), b = g.getBBox(), m = g.transform.baseVal.consolidate().matrix, s = Number(g.getAttribute('stroke-width')) / 2;
    return { x: m.e + (b.x - s) * m.a, y: m.f + (b.y - s) * m.d, w: (b.width + 2 * s) * m.a, h: (b.height + 2 * s) * m.d };
});
const placed = (canvas, width) => { const k = width / box.w; return `<g transform="translate(${(canvas - width) / 2 - box.x * k} ${(canvas - box.h * k) / 2 - box.y * k}) scale(${k})">${glyph}</g>`; };
const root = (size, view, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${view} ${view}">${inner}</svg>`;
async function shot(file, size, body, alpha) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${body}`);
    const tmp = file + '.tmp.png';
    await page.screenshot({ path: tmp, omitBackground: alpha });
    // fixed pixel format: stores reject an alpha channel where there must be none
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-pix_fmt', alpha ? 'rgba' : 'rgb24', '-frames:v', '1', '-update', '1', file]);
    fs.rmSync(tmp);
    console.log(`  ${path.relative(REPO, file)}  ${size}px`);
}
const full = `<rect width="128" height="128" fill="${BG}"/>`;

if (want('android')) {
    const MAIN = path.join(REPO, 'mobile', 'android', 'app', 'src', 'main');
    // adaptive icon: 432 px canvas, 288 px visible, 264 px safe circle
    await shot(`${MAIN}/res/drawable-nodpi/ic_launcher_background.png`, 432, root(432, 432, `<rect width="432" height="432" fill="${BG}"/>`), false);
    await shot(`${MAIN}/res/drawable-nodpi/ic_launcher_foreground.png`, 432, root(432, 432, placed(432, 156)), true);
    await shot(`${MAIN}/ic_launcher-playstore.png`, 512, root(512, 128, full + placed(128, 68)), false);
    for (const [dpi, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
        await shot(`${MAIN}/res/mipmap-${dpi}/ic_launcher.png`, size, root(size, 128, `<rect width="128" height="128" rx="33" fill="${BG}"/>` + placed(128, 68)), true);
        await shot(`${MAIN}/res/mipmap-${dpi}/ic_launcher_round.png`, size, root(size, 128, `<circle cx="64" cy="64" r="64" fill="${BG}"/>` + placed(128, 68)), true);
    }
}
if (want('ios')) {
    // one 1024 px square, full bleed and opaque: iOS rounds the corners itself
    const dir = path.join(REPO, 'mobile', 'ios', 'App', 'Assets.xcassets');
    fs.mkdirSync(path.join(dir, 'AppIcon.appiconset'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'AppIcon.appiconset', 'Contents.json'), JSON.stringify({ images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
    await shot(path.join(dir, 'AppIcon.appiconset', 'icon-1024.png'), 1024, root(1024, 128, full + placed(128, 70)), false);
    // the same picture for use inside the app (an app icon set cannot be loaded as an image)
    fs.mkdirSync(path.join(dir, 'Logo.imageset'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Logo.imageset', 'Contents.json'), JSON.stringify({ images: [{ filename: 'logo.png', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
    await shot(path.join(dir, 'Logo.imageset', 'logo.png'), 192, root(192, 128, full + placed(128, 70)), false);
}
await browser.close();
