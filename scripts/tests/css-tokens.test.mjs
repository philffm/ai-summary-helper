// The site stylesheet's token architecture (see the comment at the top of docs/assets/styles.css):
// palette → roles → components. Components read roles only; a theme changes token values, never component rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const CSS = fs.readFileSync('docs/assets/styles.css', 'utf8');
const STRIPPED = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
// set per element by the HTML (style attribute) or by script (style.setProperty)
const RUNTIME = new Set(['--img', '--s', '--cw', '--ch', '--p-a', '--p-sugg', '--p-panel', '--p-hl', '--p-qa', '--p-graph', '--i', '--ds', '--fw', '--fh', '--bgpos', '--dw']);
const PALETTE = /^--(gray|stone|navy|red|brand-accent|brand-highlight)-/;   // the primitive tier the site exposes (generated from design-system/tokens)

/** Every rule as { selector, decls: [[prop, value]], tokenBlock } (at-rule wrappers are skipped, their rules are kept). */
function rules(css = STRIPPED) {
    const out = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().replace(/^@[^{]*$/, '');
        if (!selector || /^(from|to|\d+%)/.test(selector)) continue;
        const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
        out.push({ selector, decls, tokenBlock: decls.length > 0 && decls.every(([p]) => p.startsWith('--') || p === 'color-scheme') });
    }
    return out;
}
const defined = new Set([...STRIPPED.matchAll(/(?<![\w-])(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]));

test('every token read is defined (a fallback does not count)', () => {
    const read = [...STRIPPED.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(read.filter((v) => !defined.has(v) && !RUNTIME.has(v)))], []);
});

test('every token defined is read somewhere', () => {
    const scripts = ['docs/assets/main.js', 'docs/index.html'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const read = new Set([...STRIPPED.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    assert.deepEqual([...defined].filter((d) => !read.has(d) && !RUNTIME.has(d) && !scripts.includes(d)), []);
});

test('components read roles: no hex or rgb() and no palette value outside a token', () => {
    const bad = [];
    for (const r of rules()) for (const [prop, value] of r.decls) {
        if (prop.startsWith('--') || /mask/.test(prop)) continue;   // a token may hold a value; #000 in a mask is coverage, not colour
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) bad.push(`${r.selector} { ${prop}: ${value} }`);
        for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) if (PALETTE.test(m[1])) bad.push(`${r.selector} reads palette ${m[1]}`);
    }
    assert.deepEqual(bad, []);
});

test('a theme selector only sets tokens (or switches which icon shows)', () => {
    const bad = rules().filter((r) => /data-theme/.test(r.selector) && !r.tokenBlock && !r.decls.every(([p]) => p === 'display'));
    assert.deepEqual(bad.map((r) => r.selector), []);
});

test('font sizes and corner radii come from the scales (the hero mock is a design canvas of its own)', () => {
    const bad = [];
    for (const r of rules()) {
        if (/\.hs-(?!watch|pp|dot|ctrl)|\.hscene(?!-mcap)/.test(r.selector)) continue;
        for (const [prop, value] of r.decls) {
            if (prop.startsWith('--')) continue;
            if (prop === 'font-size' && /^\d[\d.]*px$/.test(value)) bad.push(`${r.selector} { font-size: ${value} }`);
            if (prop === 'font' && !/clamp|calc|min\(|max\(/.test(value) && /(^|\s)\d[\d.]*px/.test(value)) bad.push(`${r.selector} { font: ${value} }`);
            if (/radius/.test(prop) && /(^|\s)\d[\d.]*px/.test(value)) bad.push(`${r.selector} { ${prop}: ${value} }`);
        }
    }
    assert.deepEqual(bad, []);
});

test('!important only where it must beat an inline style or the hidden attribute', () => {
    const bad = rules().filter((r) => r.decls.some(([, v]) => /!important/.test(v)) && !/\[hidden\]|:fullscreen|:-webkit-full-screen/.test(r.selector));
    assert.deepEqual(bad.map((r) => r.selector), []);
});

test('the old colour-named tokens are gone from the stylesheet, the pages and the scripts', () => {
    const old = /var\(\s*--(paper|paper-dim|signal|signal-light|ink-\d+|steel-\d+|cta-sky-\d|cta-amber-\d|brass|brass-light|sky|sky-light|amber|amber-light|gold|gold-text|gold-fill|gold-fill-hover|on-gold|glow-sky|glow-amber|tint-gold|blue-\d+|amber-\d+|icon-(cyan|indigo|violet|gold|amber|teal)-\d)\)/;
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(html|js|css)$/.test(e.name)) files.push(f); });
    walk('docs');
    assert.deepEqual(files.filter((f) => old.test(fs.readFileSync(f, 'utf8'))), []);
});

test('the selected FAQ filter has a readable label on its blue fill', () => {
    const rule = CSS.match(/\.faq-filter\[aria-pressed="true"\][^{]*\{([^}]*)\}/);
    assert.ok(rule, 'a rule for the pressed state');
    assert.match(rule[1], /background:var\(--accent-fill\)/);
    assert.match(rule[1], /color:var\(--on-accent\)/);
});
