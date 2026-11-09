// Smaller _locales in the built extension (the source in plugin/src/_locales stays as it is, pretty and with notes):
//   1. keys no code uses are dropped (strings removed from the UI over time stay in the source until feed-i18n prunes them),
//   2. `description` (notes for translators) is kept in en only, the browser never reads it,
//   3. JSON without indentation.
// A key counts as used when (a) its English text is passed to T / TU / TN / N_ / lbl / srT anywhere in the source, or
// (b) the key itself appears literally in any source file or platform manifest (data-i18n="…", getMessage('…'),
// __MSG_…__), or (c) its English text appears as any string literal (T(a ? 'x' : 'y'), label tables). Scans every file, not a fixed list, so a forgotten file can only keep keys, never lose them.
//   node plugin/scripts/slim-locales.mjs <built extension dir>      slim a build in place and report
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const { i18nKey } = await import(pathToFileURL(path.join(SRC, 'modules', 'i18nKey.js')).href);

function sourceFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '_locales' || e.name === 'lib' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...sourceFiles(p));
        else if (/\.(m?js|html|json|css)$/.test(e.name)) out.push(p);
    }
    return out;
}

const unquote = (q, body) => { try { return new Function('return ' + q + body + q)(); } catch (_) { return null; } };
const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`(?:[^`\\\\$]|\\\\.)*`)';
const CALL = new RegExp(String.raw`\b(?:T|TU|N_|lbl|srT)\(\s*` + LIT, 'g');
const CALL_N = new RegExp(String.raw`\bTN\([^,]+?,\s*` + LIT + String.raw`\s*,\s*` + LIT, 'g');

/** Every message key the extension can ask for, given the en dictionary. */
export function usedKeys(enMessages, srcDir = SRC) {
    const text = sourceFiles(srcDir).map((f) => fs.readFileSync(f, 'utf8'));
    const platforms = path.join(path.dirname(srcDir), 'platforms');
    if (fs.existsSync(platforms)) for (const p of fs.readdirSync(platforms)) {
        const m = path.join(platforms, p, 'manifest.json');
        if (fs.existsSync(m)) text.push(fs.readFileSync(m, 'utf8'));
    }
    const used = new Set();
    for (const src of text) {
        for (const m of src.matchAll(CALL)) { const v = unquote(m[1][0], m[1].slice(1, -1)); if (v) used.add(i18nKey(v)); }
        for (const m of src.matchAll(CALL_N)) for (const g of [m[1], m[2]]) { const v = unquote(g[0], g.slice(1, -1)); if (v) used.add(i18nKey(v)); }
    }
    // (c) any string literal whose key exists: covers T(cond ? 'a' : 'b'), lookup tables of English labels and the like
    const ANY = new RegExp(LIT, 'g');
    for (const src of text) for (const m of src.matchAll(ANY)) {
        const v = unquote(m[1][0], m[1].slice(1, -1));
        if (v && v.length > 1) { const k = i18nKey(v); if (k in enMessages) used.add(k); }
    }
    const all = text.join('\n');
    for (const k of Object.keys(enMessages)) if (!used.has(k) && all.includes(k)) used.add(k);
    return used;
}

/** Slim <dir>/_locales in place. Returns { locales, dropped, before, after } (bytes). */
export function slimLocales(dir, srcDir = SRC) {
    const loc = path.join(dir, '_locales');
    if (!fs.existsSync(loc)) return { locales: 0, dropped: 0, before: 0, after: 0 };
    const en = JSON.parse(fs.readFileSync(path.join(loc, 'en', 'messages.json'), 'utf8'));
    const used = usedKeys(en, srcDir);
    let before = 0, after = 0, locales = 0;
    for (const l of fs.readdirSync(loc)) {
        const f = path.join(loc, l, 'messages.json');
        if (!fs.existsSync(f)) continue;
        const raw = fs.readFileSync(f, 'utf8');
        const m = JSON.parse(raw);
        const out = {};
        for (const [k, v] of Object.entries(m)) {
            if (!used.has(k)) continue;
            out[k] = l === 'en' || !v.description ? v : { message: v.message };
        }
        const next = JSON.stringify(out);
        fs.writeFileSync(f, next);
        before += Buffer.byteLength(raw); after += Buffer.byteLength(next); locales++;
    }
    return { locales, dropped: Object.keys(en).length - [...Object.keys(en)].filter((k) => used.has(k)).length, before, after };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const dir = process.argv[2];
    if (!dir) { console.error('usage: node plugin/scripts/slim-locales.mjs <built extension dir>'); process.exit(1); }
    const r = slimLocales(path.resolve(dir));
    console.log(`slimmed ${r.locales} locales: ${r.dropped} unused keys dropped, ${Math.round(r.before / 1024)} KB → ${Math.round(r.after / 1024)} KB`);
}
