#!/usr/bin/env node
/**
 * brands/index.mjs: the white-label layer.
 *
 * The source tree is written in ONE brand (brands/aish.json, "AI Summary Helper" / "AISH"). Every other brand is a
 * small JSON delta (brands/<id>.json) that this module applies to a finished build directory, so the source never
 * forks and the default build is untouched (applying the default brand is a no-op).
 *
 * What is rewritten:   the product name and short name (UI text, locale values, store listing, docs), the brand
 *                      colours (hex map), icons, per-platform manifest fields, the site host.
 * What is NEVER touched: lookup keys (T('…') literals and the f_<slug>_<hash> message keys derived from them), storage
 *                      keys, CSS class names, AISH_* globals, the byphil umbrella brand, kindle@byphil.eu, API paths.
 *
 * The UI looks strings up by a hash of the ENGLISH SOURCE TEXT, so rewriting a T('Sign in to AI Summary Helper')
 * literal would silently break that string's translation in every language. JS therefore masks T/TN/TU/N_/lbl
 * literals while rewriting, and JSON walks values only (never keys). The brand text reaches the user through the
 * rewritten locale VALUES.
 *
 * CLI:
 *   node brands/index.mjs list
 *   node brands/index.mjs apply <brand> <extension|site> <dir> [--platform chrome] [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
export const DEFAULT_BRAND = 'aish';   // the brand the source tree is written in; the others are applied on top of it
export const BUILD_BRAND = 'kaivo';    // what the builds produce when no brand is named (`--aish` builds the source brand only)

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Loading ────────────────────────────────────────────────────────────────

export function listBrands() {
    return fs.readdirSync(HERE).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

export function loadBrand(id = DEFAULT_BRAND) {
    const file = path.join(HERE, `${id}.json`);
    if (!fs.existsSync(file)) throw new Error(`Unknown brand "${id}". Available: ${listBrands().join(', ')}`);
    return { ...JSON.parse(fs.readFileSync(file, 'utf8')), dir: path.join(HERE, id) };
}

export const isDefault = (brand) => !brand || brand.id === DEFAULT_BRAND;

/** `--<id>` / `--brand=<id>` anywhere in argv (or BRAND=<id> in the environment) → brand id; BUILD_BRAND otherwise. */
export function brandIdFromArgs(args = [], env = process.env) {
    const known = listBrands();
    for (const a of args) {
        if (a.startsWith('--brand=')) return a.slice(8);
        if (a.startsWith('--') && known.includes(a.slice(2))) return a.slice(2);
    }
    return env.BRAND || BUILD_BRAND;
}

// ── Text rules ─────────────────────────────────────────────────────────────

/** Compile a brand's delta (against the default brand) into text and colour rules. null for the default brand. */
export function compileRules(brand) {
    if (isDefault(brand)) return null;
    const base = loadBrand(DEFAULT_BRAND);
    const text = [
        ...(brand.replace || []).map(([from, to]) => [new RegExp(from, 'g'), to]),
        [new RegExp(esc(base.name), 'g'), brand.name],
        [new RegExp(`\\b${esc(base.short)}\\b`, 'g'), brand.short],
    ];
    if (brand.siteHost && base.siteHost) text.push([new RegExp(esc(base.siteHost), 'g'), brand.siteHost]);
    const colors = brand.colors || {};
    const keys = Object.keys(colors);
    // rgba(96,165,250 matches however the commas are spaced; hex matches only as a whole colour.
    const pat = keys.map((k) => (k.startsWith('#') ? esc(k) + '(?![0-9a-fA-F])' : esc(k).replace(/,/g, ',\\s*')));
    const colorRe = keys.length ? new RegExp(pat.join('|'), 'gi') : null;
    const lookup = (hit) => {
        const norm = hit.toLowerCase().replace(/\s+/g, '');
        const k = keys.find((key) => key.toLowerCase().replace(/\s+/g, '') === norm);
        return k ? colors[k] : hit;
    };
    return { text, colorRe, lookup };
}

function rewrite(s, rules, stats) {
    let out = s;
    for (const [re, to] of rules.text) out = out.replace(re, () => { stats.text++; return to; });
    if (rules.colorRe) out = out.replace(rules.colorRe, (m) => { stats.colors++; return rules.lookup(m); });
    return out;
}

// ── i18n-safe JS rewriting ─────────────────────────────────────────────────

const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`(?:[^`\\\\]|\\\\.)*`)';
// The same shapes scripts/feed-i18n.mjs extracts: T('x') TU('x') N_('x') lbl('x') and TN(n, 'one', 'other').
const I18N_RES = [
    new RegExp(String.raw`\b(?:T|TU|N_|lbl)\(\s*` + LIT, 'g'),
    new RegExp(String.raw`\bTN\([^,]+?,\s*` + LIT + String.raw`\s*,\s*` + LIT, 'g'),
];

function maskI18n(src) {
    const saved = [];
    let out = src;
    for (const re of I18N_RES) out = out.replace(re, (m) => { saved.push(m); return `\u0000I18N${saved.length - 1}\u0000`; });
    return { out, unmask: (s) => s.replace(/\u0000I18N(\d+)\u0000/g, (_, i) => saved[+i]), saved };
}

function rewriteJs(src, rules, stats) {
    const { out, unmask } = maskI18n(src);
    return unmask(rewrite(out, rules, stats));
}

function rewriteJsonValues(node, rules, stats) {
    if (typeof node === 'string') return rewrite(node, rules, stats);
    if (Array.isArray(node)) return node.map((n) => rewriteJsonValues(n, rules, stats));
    if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = rewriteJsonValues(v, rules, stats);   // keys are lookup keys: never rewritten
        return out;
    }
    return node;
}

function rewriteJson(raw, rules, stats) {
    let data;
    try { data = JSON.parse(raw); } catch { return rewrite(raw, rules, stats); }
    const indent = (raw.match(/^[{[]\r?\n( +)\S/) || [])[1]?.length;
    const before = stats.text + stats.colors;
    const next = rewriteJsonValues(data, rules, stats);
    if (stats.text + stats.colors === before) return raw;
    return JSON.stringify(next, null, indent ?? 2) + (raw.endsWith('\n') ? '\n' : '');
}

// ── Walking a build directory ──────────────────────────────────────────────

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.svg', '.md', '.txt', '.xml', '.webmanifest']);
const SKIP_DIRS = new Set(['lib', 'fonts', 'node_modules', '.git']);   // third-party code and fonts are not ours to rewrite

function* walk(dir, base = dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(full, base); }
        else yield { full, rel: path.relative(base, full).split(path.sep).join('/') };
    }
}

const deepMerge = (a, b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
    const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
    return out;
};

/**
 * Apply a brand to a finished build directory, in place.
 * @param {string} dir        the build output (an unpacked extension, or a copy of docs/)
 * @param {object} brand      loadBrand(id)
 * @param {'extension'|'site'} target
 * @param {{platform?: string}} [opts]
 */
export function applyBrand(dir, brand, target, opts = {}) {
    const rules = compileRules(brand);
    const stats = { files: 0, text: 0, colors: 0, assets: 0 };
    if (!rules) return stats;   // default brand: nothing to do, the build stays byte-identical

    for (const { full, rel } of walk(dir)) {
        if (!TEXT_EXT.has(path.extname(rel).toLowerCase()) && !/(^|\/)CNAME$/.test(rel)) continue;
        if (/\.min\./.test(rel)) continue;
        if (target === 'extension' && rel === 'manifest.json') continue;   // names there are __MSG_ references; patched below
        const raw = fs.readFileSync(full, 'utf8');
        const ext = path.extname(rel).toLowerCase();
        const next = ext === '.json' || ext === '.webmanifest' ? rewriteJson(raw, rules, stats)
            : ['.js', '.mjs', '.cjs'].includes(ext) ? rewriteJs(raw, rules, stats)
            : rewrite(raw, rules, stats);
        if (next !== raw) { fs.writeFileSync(full, next); stats.files++; }
    }

    // Design tokens: the generated stylesheet regions are rebuilt for this brand from design-system/tokens (exact values per
    // brand × theme, contrast-checked), after the hex map above, which stays for colour literals elsewhere (JS, SVG, HTML).
    if (fs.existsSync(path.join(REPO, 'design-system/tokens/primitive/brand', `${brand.id}.json`))) {
        execFileSync(process.execPath, [path.join(REPO, 'design-system/build.mjs'), `--brand=${brand.id}`, '--into', dir, '--context', target === 'extension' ? 'app' : 'site'], { stdio: 'inherit' });
    }

    for (const [to, from] of Object.entries((brand.assets || {})[target] || {})) {
        const src = path.join(brand.dir, from);
        if (!fs.existsSync(src)) { console.warn(`  ! ${brand.id}: asset ${path.relative(REPO, src)} is missing, keeping the default`); continue; }
        fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
        fs.copyFileSync(src, path.join(dir, to));
        stats.assets++;
    }

    if (target === 'extension') {
        const patch = deepMerge(brand.manifest?.all || {}, brand.manifest?.[opts.platform] || {});
        const mf = path.join(dir, 'manifest.json');
        if (Object.keys(patch).length && fs.existsSync(mf)) {
            fs.writeFileSync(mf, JSON.stringify(deepMerge(JSON.parse(fs.readFileSync(mf, 'utf8')), patch), null, 2) + '\n');
        }
    }
    return stats;
}

// ── Leak report ────────────────────────────────────────────────────────────

/**
 * Scan a branded build for the OLD brand. Three buckets:
 *  - leaks:     the old visible name outside any translation lookup key (a real miss, `--strict` fails on these)
 *  - fallbacks: the old name inside a T('…') literal; shown only if a locale lacks that key (feed-i18n check keeps that empty)
 *  - kept:      identifiers deliberately left alone (aish-* classes, aish_* storage keys, AISH_* globals)
 */
export function leakReport(dir, brand) {
    const base = loadBrand(DEFAULT_BRAND);
    const name = new RegExp(esc(base.name), 'g'), short = new RegExp(`\\b${esc(base.short)}\\b`, 'g');
    const kept = /(?:\baish[-_]|\bAISH_|__AISH|\.aish\b|aishcompanion)/gi;
    const rep = { leaks: [], fallbacks: 0, kept: 0 };
    const count = (s, re) => (s.match(re) || []).length;
    for (const { full, rel } of walk(dir)) {
        if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
        let s = fs.readFileSync(full, 'utf8');
        if (/\.m?js$/.test(rel)) {
            const { out, saved } = maskI18n(s);
            rep.fallbacks += saved.reduce((n, m) => n + count(m, name) + count(m, short), 0);
            s = out;
        }
        rep.kept += count(s, kept);
        const n = count(s, name) + count(s, short);
        if (n) rep.leaks.push({ file: rel, count: n });
    }
    return rep;
}

/** apply + report + console summary. Returns the report. */
export function brandBuild(dir, brand, target, opts = {}) {
    if (isDefault(brand)) return null;
    const stats = applyBrand(dir, brand, target, opts);
    const rep = leakReport(dir, brand);
    const tag = `${brand.name} ${target}${opts.platform ? '/' + opts.platform : ''}`;
    console.log(`  ✓ ${tag}: rebranded ${stats.files} files (${stats.text} text, ${stats.colors} colour, ${stats.assets} asset swaps)`);
    if (rep.leaks.length) console.warn(`  ! ${tag}: old brand still visible in ${rep.leaks.length} file(s): ${rep.leaks.slice(0, 5).map((l) => `${l.file}×${l.count}`).join(', ')}${rep.leaks.length > 5 ? ', …' : ''}`);
    if (opts.strict && rep.leaks.length) throw new Error(`${tag}: ${rep.leaks.length} file(s) still carry the old brand`);
    return rep;
}

export function warnProvisional(brand) {
    for (const p of brand.provisional || []) console.warn(`  ⚠ ${brand.name} build uses a provisional value: ${p}`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [cmd, ...rest] = process.argv.slice(2);
    const flag = (f) => rest.includes(f);
    const val = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
    try {
        if (cmd === 'list') {
            for (const id of listBrands()) { const b = loadBrand(id); console.log(`${id}${id === DEFAULT_BRAND ? ' (default)' : ''}: ${b.name} / ${b.short}`); }
        } else if (cmd === 'provisional') {
            warnProvisional(loadBrand(rest[0] || DEFAULT_BRAND));
        } else if (cmd === 'apply') {
            const [id, target, dir] = rest.filter((a) => !a.startsWith('--') && a !== val('--platform'));
            if (!id || !target || !dir) throw new Error('usage: brands/index.mjs apply <brand> <extension|site> <dir> [--platform chrome] [--strict]');
            brandBuild(path.resolve(dir), loadBrand(id), target, { platform: val('--platform'), strict: flag('--strict') });
        } else {
            console.log('usage: brands/index.mjs list | provisional <brand> | apply <brand> <extension|site> <dir> [--platform p] [--strict]');
            process.exit(cmd ? 1 : 0);
        }
    } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}
