#!/usr/bin/env node
/**
 * Builds the in-site live demo into plugin/dist/demo/ (git-ignored; the Pages workflow publishes it under /demo/).
 *
 * The demo runs the real popup from plugin/src. Only the parts that need a browser extension are replaced:
 * background.js / content scripts do not ship; plugin/demo/demo-shim.js fakes `chrome` and replays recorded content.
 *
 *   node plugin/scripts/build-demo.mjs            # build
 *   node plugin/scripts/build-demo.mjs --check    # build + fail if the popup uses a runtime action the mock does not know
 *   node plugin/scripts/build-demo.mjs --kaivo    # the same demo in a white-label brand (brands/<id>.json, local): name, colours, icon
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src'), DEMO = path.join(ROOT, 'demo'), OUT = path.join(ROOT, 'dist', 'demo'), APP = path.join(OUT, 'app');

// Never shipped in the demo: extension-only workers and heavy libs the demo does not reach.
const SKIP = new Set(['background.js', 'content.js', 'offscreen.html', 'offscreen.js', 'node_modules', '.DS_Store', 'pdf.mjs', 'pdf.worker.mjs', 'privacy.md', 'readme.md']);

function copy(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const a = path.join(from, e.name), b = path.join(to, e.name);
        e.isDirectory() ? copy(a, b) : fs.copyFileSync(a, b);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
copy(SRC, APP);
// Languages added later: demo/lang/<code>.js (see demo/lang/README.md), all loaded before demo-library-i18n.js
const LANG_FILES = fs.existsSync(path.join(DEMO, 'lang')) ? fs.readdirSync(path.join(DEMO, 'lang')).filter((f) => /^[a-z-]+\.js$/.test(f)).sort() : [];
fs.mkdirSync(path.join(APP, 'lang'), { recursive: true });
for (const f of LANG_FILES) fs.copyFileSync(path.join(DEMO, 'lang', f), path.join(APP, 'lang', f));
const LANG_TAGS = LANG_FILES.map((f) => `<script src="lang/${f}"></script>`).join('');
for (const f of ['demo-content.js', 'demo-i18n.js', 'demo-library-i18n.js', 'demo-scenarios-i18n.js', 'demo-scenarios.js', 'demo-shim.js', 'demo-tour-i18n.js', 'demo-tour.js']) fs.copyFileSync(path.join(DEMO, f), path.join(APP, f));

// The same popup.html, with the fake chrome loaded first.
const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
const tag = '<script src="audioEngine.js"></script>';
if (!html.includes(tag)) throw new Error('popup.html no longer has the audioEngine script tag: update build-demo.mjs');
fs.writeFileSync(path.join(APP, 'popup.html'), html.replace(tag, '<script src="demo-content.js"></script><script src="demo-i18n.js"></script>' + LANG_TAGS + '<script src="demo-library-i18n.js"></script><script src="demo-scenarios-i18n.js"></script><script src="demo-scenarios.js"></script><script src="demo-shim.js"></script>' + tag));

// The home page too (app/home.html), with the same fake chrome: store screenshots and videos of the start page use it.
{
  const home = fs.readFileSync(path.join(SRC, 'home.html'), 'utf8');
  const htag = '<script type="module" src="home.js"></script>';
  if (!home.includes(htag)) throw new Error('home.html no longer has the home.js script tag: update build-demo.mjs');
  fs.writeFileSync(path.join(APP, 'home.html'), home.replace(htag, '<script src="demo-content.js"></script><script src="demo-i18n.js"></script>' + LANG_TAGS + '<script src="demo-library-i18n.js"></script><script src="demo-scenarios-i18n.js"></script><script src="demo-scenarios.js"></script><script src="demo-shim.js"></script>' + htag));
}

fs.writeFileSync(path.join(OUT, 'index.html'), fs.readFileSync(path.join(DEMO, 'index.html'), 'utf8').replace('<!--LANG-->', LANG_FILES.map((f) => `<script src="app/lang/${f}"></script>`).join('')));
// The URL-parameter contract for automation (video tools, screenshot pipelines, embedding).
fs.copyFileSync(path.join(DEMO, 'README.md'), path.join(OUT, 'README.md'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'platforms', 'chrome', 'manifest.json'), 'utf8')).version || '';
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version }));

// Contract: every `action: 'x'` the popup sends to the background must be known to the mock (handled or deliberately quiet).
if (process.argv.includes('--check')) {
    const shim = fs.readFileSync(path.join(DEMO, 'demo-shim.js'), 'utf8');
    const known = new Set([...shim.matchAll(/case '([A-Za-z]+)'/g)].map(m => m[1]).concat([...shim.matchAll(/'([A-Za-z]+)'(?=[,\]])/g)].map(m => m[1])));
    const used = new Set();
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name) && !/demo-/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/sendMessage\(\s*\{\s*action:\s*'([A-Za-z]+)'/g)) used.add(m[1]); } };
    walk(APP);
    // bgSend({ action }) wrappers count too
    const wrap = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) wrap(p); else if (/\.m?js$/.test(e.name) && !/demo-/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/bgSend\(\s*\{\s*action:\s*'([A-Za-z]+)'/g)) used.add(m[1]); } };
    wrap(APP);
    const missing = [...used].filter(a => !known.has(a)).sort();
    if (missing.length) { console.error('demo-shim does not know these popup→background actions (add a case, or list them as quiet):\n  ' + missing.join('\n  ')); process.exit(1); }
    console.log(`demo contract ok: ${used.size} actions covered`);
}
// The source stylesheets are Kaivo-coloured, the source text is AISH: the plain demo gets the AISH regions back (a brand below rewrites them again).
execFileSync(process.execPath, [path.join(ROOT, '..', 'design-system', 'build.mjs'), '--brand=aish', '--into', APP, '--context', 'app'], { stdio: 'inherit' });
// Brand: `--<brand>` / `--brand=<id>` applies a white-label brand to the finished demo (videos/public/demo points here, so the
// clips render in that brand). brands/ is a local, uncommitted layer: without it the flag is reported and the default demo stays.
const BRANDS = path.join(ROOT, '..', 'brands', 'index.mjs');
if (fs.existsSync(BRANDS)) {
    const { brandIdFromArgs, loadBrand, isDefault, brandBuild, warnProvisional } = await import(pathToFileURL(BRANDS).href);
    const brand = loadBrand(brandIdFromArgs(process.argv.slice(2)));
    if (!isDefault(brand)) {
        warnProvisional(brand);
        brandBuild(APP, brand, 'extension', { platform: 'chrome' });
        for (const f of ['index.html', 'README.md']) { const q = path.join(OUT, f); fs.writeFileSync(q, fs.readFileSync(q, 'utf8').replaceAll('AI Summary Helper', brand.name)); }
    }
} else if (process.argv.slice(2).some((a) => a.startsWith('--') && a !== '--check')) {
    console.warn('  ! brand flag ignored: brands/index.mjs is not in this checkout');
}
console.log('demo built →', path.relative(process.cwd(), OUT));
