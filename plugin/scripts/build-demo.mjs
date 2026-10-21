#!/usr/bin/env node
/**
 * Builds the in-site live demo into plugin/dist/demo/ (git-ignored; the Pages workflow publishes it under /demo/).
 *
 * The demo runs the real popup from plugin/src. Only the parts that need a browser extension are replaced:
 * background.js / content scripts do not ship; plugin/demo/demo-shim.js fakes `chrome` and replays recorded content.
 *
 *   node plugin/scripts/build-demo.mjs            # build
 *   node plugin/scripts/build-demo.mjs --check    # build + fail if the popup uses a runtime action the mock does not know
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
for (const f of ['demo-content.js', 'demo-i18n.js', 'demo-library-i18n.js', 'demo-scenarios-i18n.js', 'demo-scenarios.js', 'demo-shim.js', 'demo-tour-i18n.js', 'demo-tour.js']) fs.copyFileSync(path.join(DEMO, f), path.join(APP, f));

// The same popup.html, with the fake chrome loaded first.
const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
const tag = '<script src="audioEngine.js"></script>';
if (!html.includes(tag)) throw new Error('popup.html no longer has the audioEngine script tag: update build-demo.mjs');
fs.writeFileSync(path.join(APP, 'popup.html'), html.replace(tag, '<script src="demo-content.js"></script><script src="demo-i18n.js"></script><script src="demo-library-i18n.js"></script><script src="demo-scenarios-i18n.js"></script><script src="demo-scenarios.js"></script><script src="demo-shim.js"></script>' + tag));

fs.copyFileSync(path.join(DEMO, 'index.html'), path.join(OUT, 'index.html'));
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
console.log('demo built →', path.relative(process.cwd(), OUT));
