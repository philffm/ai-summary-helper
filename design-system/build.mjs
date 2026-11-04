#!/usr/bin/env node
// design-system/build.mjs: the token pipeline. Source: design-system/tokens/**/*.json (DTCG). Nothing it writes is edited by hand.
//
//   npm run tokens                         write the generated regions in the stylesheets + dist/ (Figma, Android, resolved JSON)
//   npm run tokens:check                   CI gate: regions up to date, tier rules, token-clean component CSS, WCAG AA per brand × theme
//   node design-system/build.mjs --brand=koru --into <build dir> --context app|site
//                                          rewrite the regions of a built copy for another brand (used by brands/index.mjs)
//
// Tiers: primitive (tokens/primitive: raw values, per brand under primitive/brand) → semantic (what a value is for, themable)
// → component (one component's own roles). A context token's CSS name is its leaf key: {app.semantic.text.text-primary} → --text-primary.
// Rules (checked): primitives hold literals only; semantic tokens never read component tokens; component CSS reads semantic or
// component tokens only (no colour literals, no primitives, no undefined tokens).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DS, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DS, 'config.json'), 'utf8'));
const EXT = 'eu.byphil.ds';
const args = process.argv.slice(2);
const opt = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); if (a) return a.slice(k.length + 3); const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const flag = (k) => args.includes(`--${k}`);

// ── load ────────────────────────────────────────────────────────────────────
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function flatten(node, prefix, inheritedType, out, file) {
    for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('$') || typeof v !== 'object') continue;
        const p = prefix ? `${prefix}.${k}` : k;
        const type = v.$type || node.$type || inheritedType;
        if ('$value' in v) out.set(p, { path: p, name: k, type, value: v.$value, description: v.$description, ext: (v.$extensions || {})[EXT] || {}, file });
        else flatten(v, p, type, out, file);
    }
    return out;
}
const brandIds = fs.readdirSync(path.join(DS, 'tokens/primitive/brand')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const PRIMITIVE = flatten(readJson(path.join(DS, 'tokens/primitive/color.json')), '', undefined, new Map(), 'primitive/color');
const BRAND = Object.fromEntries(brandIds.map((b) => [b, flatten(readJson(path.join(DS, `tokens/primitive/brand/${b}.json`)), '', undefined, new Map(), `primitive/brand/${b}`)]));
const BRAND_META = Object.fromEntries(brandIds.map((b) => [b, readJson(path.join(DS, `tokens/primitive/brand/${b}.json`))]));
const SETS = {};   // 'app/light' → Map(path → token)
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'primitive') walk(f); continue; }
        if (!e.name.endsWith('.json')) continue;
        const id = path.relative(path.join(DS, 'tokens'), f).replace(/\\/g, '/').replace(/\.json$/, '');
        SETS[id] = flatten(readJson(f), '', undefined, new Map(), id);
    }
})(path.join(DS, 'tokens'));

const ctxOf = (p) => p.split('.')[0];
const tierOf = (p) => p.split('.')[1];
const isContext = (p) => p in CONFIG.contexts || Object.keys(CONFIG.contexts).includes(ctxOf(p));
const REF = /\{([^{}@]+?)(?:@([\d.]+))?\}/g;

// ── colour maths ────────────────────────────────────────────────────────────
function parseColor(s) {
    s = String(s).trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) { let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }; }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = s.match(/^hsla?\(([^)]+)\)$/);
    if (m) {
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x));
        const [h, sat, l] = [p[0] / 360, p[1] / 100, p[2] / 100];
        const f = (n) => { const k = (n + h * 12) % 12; return l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a: p.length > 3 ? p[3] : 1 };
    }
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    return null;
}
const rgbaStr = (c, a) => `rgba(${c.r},${c.g},${c.b},${+(a ?? c.a).toFixed(3)})`;
const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = (c) => { const f = [c.r, c.g, c.b].map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function mixColor(expr) {   // color-mix(in srgb, A p%, B) with literal colours
    const m = expr.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/);
    if (!m) return null;
    const a = parseColor(m[1]), b = m[3].trim() === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(m[3]), t = +m[2] / 100;
    if (!a || !b) return null;
    const alpha = a.a * t + b.a * (1 - t);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const ch = (k) => (a[k] * a.a * t + b[k] * b.a * (1 - t)) / alpha;
    return { r: Math.round(ch('r')), g: Math.round(ch('g')), b: Math.round(ch('b')), a: +alpha.toFixed(4) };
}

// ── resolution ──────────────────────────────────────────────────────────────
function primitive(p, brand) {
    const t = p.startsWith('brand.') ? BRAND[brand].get(p) : PRIMITIVE.get(p);
    if (!t) throw new Error(`unknown primitive {${p}}`);
    if (REF.test(String(t.value))) { REF.lastIndex = 0; throw new Error(`primitive {${p}} must hold a literal, not a reference`); }
    return t;
}
const pct = (a) => `${+(a * 100).toFixed(2)}%`;
/** CSS text of a reference inside an output: context tokens stay live (var), primitives become literals. */
function refCss(p, alpha, brand) {
    if (isContext(p)) {
        const name = p.split('.').pop();
        return alpha == null ? `var(--${name})` : `color-mix(in srgb, var(--${name}) ${pct(alpha)}, transparent)`;
    }
    const lit = primitive(p, brand).value;
    if (alpha == null) return lit;
    const c = parseColor(lit);
    if (!c) throw new Error(`alpha on a non-colour primitive {${p}}`);
    return rgbaStr(c, alpha);
}
function cssValue(t, brand) {
    const v = String(t.value);
    if (t.ext.template) return v.replace(REF, (_, p, a) => refCss(p, a == null ? null : +a, brand));
    const m = v.match(/^\{([^{}@]+)\}$/);
    if (m) return refCss(m[1], t.ext.alpha ?? null, brand);
    if (t.ext.alpha != null) throw new Error(`${t.path}: alpha needs a reference`);
    return v;
}
/** Effective value of a context token in a theme: literal CSS (vars substituted) or a colour. */
function resolveIn(name, stack, brand, seen = new Set()) {
    if (seen.has(name)) throw new Error(`reference cycle through --${name}`);
    seen.add(name);
    let tok = null;
    for (const id of stack) for (const t of SETS[id].values()) if (t.name === name) tok = t;
    if (!tok) return null;
    let css = cssValue(tok, brand);
    css = css.replace(/var\(--([\w-]+)\)/g, (m, n) => { const r = resolveIn(n, stack, brand, new Set(seen)); return r == null ? m : r; });
    return css;
}
const colorOf = (css) => css && (parseColor(css) || mixColor(css.replace(/\s+/g, ' ')));

// ── checks ──────────────────────────────────────────────────────────────────
const problems = [], warnings = [];
function checkTiers() {
    for (const [id, set] of Object.entries(SETS)) {
        const ctx = id.split('/')[0];
        const names = new Map();
        for (const t of set.values()) {
            if (ctxOf(t.path) !== ctx) problems.push(`${id}: token ${t.path} must live under "${ctx}."`);
            const tier = tierOf(t.path);
            if (!['primitive', 'semantic', 'component'].includes(tier)) problems.push(`${t.path}: tier must be primitive, semantic or component`);
            if (names.has(t.name)) problems.push(`${id}: --${t.name} defined twice`);
            // naming: the tier shows in the name without an abbreviation. A component token starts with its component
            // (its group): --player-bg, --sheet-grab, --saved-note-user-bg (or --on-<component>-… for content on it).
            const group = t.path.split('.')[2];
            if (tier === 'component' && !(t.name.startsWith(group + '-') || t.name.startsWith('on-' + group)))
                problems.push(`${t.path}: a component token is named after its component: --${group}-…`);
            names.set(t.name, t);
            for (const [, p] of String(t.value).matchAll(REF)) {
                if (isContext(p)) {
                    if (ctxOf(p) !== ctx) problems.push(`${t.path} reads another context: {${p}}`);
                    if (tier === 'semantic' && tierOf(p) === 'component') problems.push(`${t.path}: a semantic token must not read a component token ({${p}})`);
                    if (tier === 'primitive' && tierOf(p) !== 'primitive') problems.push(`${t.path}: a primitive must not read ${tierOf(p)} tokens`);
                } else {
                    try { brandIds.forEach((b) => primitive(p, b)); } catch (e) { problems.push(`${t.path}: ${e.message}`); }
                }
            }
            // component layer: aliases of semantic tokens, no theme of its own. A component colour/shadow is defined once (in the
            // context's base set) and references semantic or component tokens only. Exceptions are explicit:
            // `fixed` (same in every theme, e.g. a third-party mark; may read a primitive) and `scene` (the website's hero mock
            // and photo stage: pictures with their own small palette, scoped sets in config.json).
            if (tier === 'component' && ['color', 'shadow', 'gradient'].includes(t.type) && !t.ext.scene) {
                const refs = [...String(t.value).matchAll(REF)].map((m) => m[1]);
                if (!id.endsWith('/base')) problems.push(`${t.path}: a component token has no theme of its own; define it once in ${ctx}/base and give the theme values to a semantic token`);
                if (!t.ext.fixed) {
                    if (!refs.length && !['none', 'transparent'].includes(String(t.value))) problems.push(`${t.path}: a component token must reference a semantic token`);
                    for (const p of refs) if (!isContext(p) || tierOf(p) === 'primitive') problems.push(`${t.path}: reads {${p}}; a component token reads semantic or component tokens (or is marked "fixed" with a reason)`);
                    if (t.ext.alpha != null) problems.push(`${t.path}: no alpha on a component alias (Figma cannot alias with an alpha); make a semantic token for it`);
                }
            }
            if (!/^\{[^{}]+\}$/.test(String(t.value)) && !t.ext.template && t.type === 'color' && tier !== 'primitive' && String(t.value) !== 'transparent' && String(t.value) !== 'none')
                problems.push(`${t.path}: a ${tier} colour must reference a primitive or a token, not hold ${t.value}`);
        }
    }
    // every token a later set overrides must exist in the base of that context
}
function checkComponentCss(file, regions, ctx) {
    const raw = fs.readFileSync(path.join(REPO, file), 'utf8');
    let body = raw;
    for (const r of regions) body = body.replace(new RegExp(`/\\* @tokens:start ${r} \\*/[\\s\\S]*?/\\* @tokens:end ${r} \\*/`), '');
    body = body.replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set([...raw.matchAll(/(?<![\w-])(--[a-z][\w-]*)\s*:/g)].map((m) => m[1]));
    const primNames = new Set(Object.values(SETS).flatMap((s) => [...s.values()]).filter((t) => tierOf(t.path) === 'primitive').map((t) => '--' + t.name));
    const runtime = new Set(CONFIG.runtimeTokens?.[ctx] || []);
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim(); if (/^(from|to|\d+%)/.test(sel)) continue;
        for (const d of m[2].split(';')) {
            const i = d.indexOf(':'); if (i < 0) continue;
            const prop = d.slice(0, i).trim(), val = d.slice(i + 1).trim();
            const where = `${file}: ${sel.replace(/\s+/g, ' ').slice(0, 70)} { ${prop} }`;
            if (!/mask/.test(prop) && !prop.startsWith('--') && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(val)) problems.push(`${where}: colour literal ${val.slice(0, 60)} (use a semantic or component token)`);
            for (const r of val.matchAll(/var\(\s*(--[\w-]+)(\s*,)?/g)) {
                if (primNames.has(r[1])) problems.push(`${where}: reads the primitive ${r[1]}`);
                if (!r[2] && !defined.has(r[1]) && !runtime.has(r[1])) problems.push(`${where}: reads ${r[1]}, which is defined nowhere`);
            }
        }
    }
}
function checkContrast() {
    const rows = [];
    for (const [ctx, pairs] of Object.entries(CONFIG.contrast)) {
        if (ctx.startsWith('$')) continue;
        for (const brand of brandIds) for (const [mode, stack] of Object.entries(CONFIG.contexts[ctx].stacks)) {
            for (const pr of pairs) for (const fgN of pr.fg) for (const bgN of pr.bg) {
                const base = colorOf(resolveIn(pr.over, stack, brand));
                const fgC = colorOf(resolveIn(fgN, stack, brand)), bgC = colorOf(resolveIn(bgN, stack, brand));
                if (!fgC || !bgC || !base) { warnings.push(`contrast: cannot resolve ${fgN}/${bgN} (${ctx} ${brand} ${mode})`); continue; }
                const bg = over(bgC, over(base, { r: 255, g: 255, b: 255, a: 1 }));
                const r = ratio(over(fgC, bg), bg), min = pr.min || 4.5;
                rows.push({ ctx, brand, mode, fg: fgN, bg: bgN, ratio: +r.toFixed(2), min });
                if (r < min) problems.push(`contrast ${ctx}/${brand}/${mode}: --${fgN} on --${bgN} is ${r.toFixed(2)}:1, needs ${min}:1`);
            }
        }
    }
    return rows;
}

// ── generate ────────────────────────────────────────────────────────────────
function tokensOfSets(sets) {
    const out = new Map();
    for (const id of sets) { if (!SETS[id]) throw new Error(`unknown token set ${id}`); for (const t of SETS[id].values()) out.set(t.name, t); }
    return [...out.values()];
}
function renderRegion(output, brand) {
    const lines = [`/* @tokens:start ${output.region} */`, `/* Generated by design-system/build.mjs from design-system/tokens (${output.context}${brand !== CONFIG.defaultBrand ? `, brand ${brand}` : ''}). Do not edit: change the JSON, then npm run tokens. */`];
    for (const b of output.blocks) {
        if (b.comment) lines.push(`/* ${b.comment} */`);
        const ind = b.media ? '  ' : '';
        if (b.media) lines.push(`@media ${b.media} {`);
        lines.push(`${ind}${b.selector.replace(/\n/g, '\n' + ind)} {`);
        let group = '';
        const toks = tokensOfSets(b.sets), rank = { primitive: 0, semantic: 1, component: 2 }, firstSeen = new Map();
        toks.forEach((t) => { const g = t.path.split('.').slice(1, 3).join('.'); if (!firstSeen.has(g)) firstSeen.set(g, firstSeen.size); });
        const key = (t) => [rank[tierOf(t.path)], firstSeen.get(t.path.split('.').slice(1, 3).join('.'))];
        toks.sort((x, y) => { const [a1, a2] = key(x), [b1, b2] = key(y); return a1 - b1 || a2 - b2; });
        for (const t of toks) {
            const g = t.path.split('.').slice(1, 3).join(' · ');
            if (g !== group) { lines.push(`${ind}  /* ${g} */`); group = g; }
            lines.push(`${ind}  --${t.name}: ${cssValue(t, brand)};${t.description ? ` /* ${t.description.replace(/\*\//g, '* /')} */` : ''}`);
        }
        for (const x of b.extra || []) lines.push(`${ind}  ${x};`);
        lines.push(`${ind}}`);
        if (b.media) lines.push('}');
    }
    lines.push(`/* @tokens:end ${output.region} */`);
    return lines.join('\n');
}
function applyRegion(text, output, brand, file) {
    const re = new RegExp(`/\\* @tokens:start ${output.region} \\*/[\\s\\S]*?/\\* @tokens:end ${output.region} \\*/`);
    if (!re.test(text)) throw new Error(`${file}: region "${output.region}" not found (add /* @tokens:start ${output.region} */ and /* @tokens:end ${output.region} */)`);
    return text.replace(re, () => renderRegion(output, brand));
}

// ── dist: resolved values, Figma, Android ───────────────────────────────────
function resolvedAll() {
    const out = {};
    for (const brand of brandIds) {
        out[brand] = {};
        for (const [ctx, c] of Object.entries(CONFIG.contexts)) {
            out[brand][ctx] = {};
            const all = { ...c.stacks, ...Object.fromEntries(Object.entries(c.scopedStacks || {}).flatMap(([scope, st]) => Object.entries(st).map(([m, s]) => [`${scope}:${m}`, [...(c.stacks[m] || Object.values(c.stacks)[0]), ...s]]))) };
            for (const [mode, stack] of Object.entries(all)) {
                const vals = {};
                for (const t of tokensOfSets(stack)) vals['--' + t.name] = { tier: tierOf(t.path), value: resolveIn(t.name, stack, brand) };
                out[brand][ctx][mode] = vals;
            }
        }
    }
    return out;
}
/** Figma (Plugin API sync, Figma Pro has no Variables REST API): Primitives (1 mode), Brand (a mode per brand), one collection per context (a mode per theme). */
function figmaExport() {
    const prim = {}, brandVars = {}, ctxCols = {};
    for (const t of PRIMITIVE.values()) { const c = parseColor(t.value); if (c) prim[t.path.replace(/^color\./, '').replace(/\./g, '/')] = { ...c, description: t.description }; }
    const brandKey = (p) => p.replace(/^brand\./, '').replace(/\./g, '/');
    for (const p of BRAND[CONFIG.defaultBrand].keys()) {
        const per = {}; let ok = true;
        for (const b of brandIds) { const c = parseColor(BRAND[b].get(p)?.value); if (!c) ok = false; per[b] = c; }
        if (ok) brandVars[brandKey(p)] = per;
    }
    // chase a context token to {primitive|brand path, alpha} for a mode, so Figma can alias instead of copying values
    function chase(name, stack, alpha = null, depth = 0) {
        let tok = null; for (const id of stack) for (const t of SETS[id].values()) if (t.name === name) tok = t;
        if (!tok || tok.ext.template || depth > 8) return null;
        const m = String(tok.value).match(/^\{([^{}@]+)\}$/); if (!m) return null;
        const a = tok.ext.alpha != null ? (alpha ?? 1) * tok.ext.alpha : alpha;
        if (isContext(m[1])) return chase(m[1].split('.').pop(), stack, a, depth + 1);
        return { ref: m[1], alpha: a };
    }
    const out = { Primitives: prim, Brand: brandVars };
    const label = (ctx) => (ctx === 'app' ? 'App' : 'Site');
    for (const [ctx, c] of Object.entries(CONFIG.contexts)) {
        // Semantic · <context>: one mode per theme; aliases Brand/Primitives where Figma can, literal otherwise
        const modes = Object.keys(c.stacks).filter((m) => m !== 'contrast');
        const vars = {};
        for (const mode of modes) for (const t of tokensOfSets(c.stacks[mode])) {
            if (t.type !== 'color' || tierOf(t.path) !== 'semantic') continue;
            const key = t.path.split('.').slice(2).join('/');   // text/text-primary
            vars[key] ??= { codeSyntax: `var(--${t.name})`, description: t.description, modes: {} };
            const ch = chase(t.name, c.stacks[mode]);
            let entry;
            if (ch && ch.ref.startsWith('brand.')) {
                if (ch.alpha == null) entry = { alias: 'Brand', name: brandKey(ch.ref) };
                else {   // Figma cannot alias with an alpha: a derived Brand variable per alpha
                    const dn = `alpha/${brandKey(ch.ref).replace(/\//g, '-')}-${Math.round(ch.alpha * 1000) / 10}`;
                    brandVars[dn] ??= Object.fromEntries(brandIds.map((b) => [b, { ...parseColor(BRAND[b].get(ch.ref).value), a: +ch.alpha.toFixed(3) }]));
                    entry = { alias: 'Brand', name: dn };
                }
            } else if (ch && ch.alpha == null && PRIMITIVE.has(ch.ref) && parseColor(PRIMITIVE.get(ch.ref).value)) entry = { alias: 'Primitives', name: ch.ref.replace(/^color\./, '').replace(/\./g, '/') };
            else { const col = colorOf(resolveIn(t.name, c.stacks[mode], CONFIG.defaultBrand)); if (col) entry = { value: col }; }
            if (entry) vars[key].modes[mode] = entry; else warnings.push(`figma: ${key} (${mode}) not representable`);
        }
        out[`Semantic · ${label(ctx)}`] = { modes, vars };
        // Component · <context>: one mode, every variable an alias of a semantic (or component) variable; no theme of its own
        const comp = {};
        for (const t of SETS[`${ctx}/base`].values()) {
            if (t.type !== 'color' || tierOf(t.path) !== 'component') continue;
            const key = t.path.split('.').slice(2).join('/');   // player/player-bg
            const m = String(t.value).match(/^\{([^{}@]+)\}$/);
            let entry = null;
            if (m && isContext(m[1])) entry = { alias: `${tierOf(m[1]) === 'semantic' ? 'Semantic' : 'Component'} · ${label(ctx)}`, name: m[1].split('.').slice(2).join('/') };
            else if (t.ext.fixed) {
                const ch = chase(t.name, [`${ctx}/base`]);
                if (ch && ch.alpha == null && PRIMITIVE.has(ch.ref)) entry = { alias: 'Primitives', name: ch.ref.replace(/^color\./, '').replace(/\./g, '/') };
                else if (ch && ch.alpha == null && ch.ref.startsWith('brand.')) entry = { alias: 'Brand', name: brandKey(ch.ref) };
            }
            if (entry) comp[key] = { codeSyntax: `var(--${t.name})`, description: t.description || (t.ext.fixed ? `fixed: ${t.ext.fixed}` : undefined), modes: { value: entry } };
            else warnings.push(`figma: component ${key} not representable`);
        }
        out[`Component · ${label(ctx)}`] = { modes: ['value'], vars: comp };
    }
    return { generated: 'design-system/build.mjs', brands: brandIds, collections: out };
}
function androidExport(resolved) {
    const kt = ['// Generated by design-system/build.mjs. Do not edit: change design-system/tokens, then npm run tokens.', 'package eu.byphil.aishcompanion.design', '', 'import androidx.compose.ui.graphics.Color', ''];
    const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    for (const brand of brandIds) for (const mode of ['light', 'dark']) {
        kt.push(`object ${camel(brand[0].toUpperCase() + brand.slice(1))}${mode[0].toUpperCase() + mode.slice(1)}Tokens {`);
        for (const [n, { value }] of Object.entries(resolved[brand].app[mode])) {
            const c = colorOf(value); if (!c) continue;
            const argb = [Math.round(c.a * 255), c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
            kt.push(`    val ${camel(n.slice(2))} = Color(0x${argb})`);
        }
        kt.push('}', '');
    }
    return kt.join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────
try {
    const brand = opt('brand') || CONFIG.defaultBrand;
    if (!brandIds.includes(brand)) throw new Error(`unknown brand ${brand} (have: ${brandIds.join(', ')})`);
    checkTiers();
    const into = opt('into');
    if (into) {   // brand build: rewrite the regions of an already built copy
        const ctx = opt('context');
        for (const o of CONFIG.outputs.filter((x) => !ctx || x.context === ctx)) {
            const f = path.join(into, o.brandBuildPath);
            if (!fs.existsSync(f)) continue;
            fs.writeFileSync(f, applyRegion(fs.readFileSync(f, 'utf8'), o, brand, f));
        }
        if (problems.length) throw new Error(problems.join('\n'));
        console.log(`  ✓ tokens: ${brand} regions written into ${path.relative(REPO, into) || into}`);
        process.exit(0);
    }
    const files = {};
    for (const o of CONFIG.outputs) { files[o.file] ??= fs.readFileSync(path.join(REPO, o.file), 'utf8'); files[o.file] = applyRegion(files[o.file], o, CONFIG.defaultBrand, o.file); }
    const resolved = resolvedAll();
    const dist = {
        'dist/tokens.resolved.json': JSON.stringify(resolved, null, 1) + '\n',
        'dist/figma.json': JSON.stringify(figmaExport(), null, 1) + '\n',
        'dist/android/DesignTokens.kt': androidExport(resolved),
    };
    if (flag('check')) {
        for (const [f, txt] of Object.entries(files)) if (fs.readFileSync(path.join(REPO, f), 'utf8') !== txt) problems.push(`${f}: generated tokens are out of date, run npm run tokens`);
        for (const [f, txt] of Object.entries(dist)) { const p = path.join(DS, f); if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== txt) problems.push(`design-system/${f}: out of date, run npm run tokens`); }
    } else {
        for (const [f, txt] of Object.entries(files)) fs.writeFileSync(path.join(REPO, f), txt);
        for (const [f, txt] of Object.entries(dist)) { const p = path.join(DS, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); }
    }
    const byFile = {};
    for (const o of CONFIG.outputs) (byFile[o.file] ??= { ctx: o.context, regions: [] }).regions.push(o.region);
    for (const [f, { ctx, regions }] of Object.entries(byFile)) checkComponentCss(f, regions, ctx);
    const rows = checkContrast();
    if (flag('report')) for (const r of rows) console.log(`${r.ratio >= r.min ? '  ' : '✗ '}${r.ctx}/${r.brand}/${r.mode}  --${r.fg} on --${r.bg}: ${r.ratio}:1`);
    for (const w of warnings) console.warn('  ! ' + w);
    if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
    const n = Object.values(SETS).reduce((s, m) => s + m.size, 0) + PRIMITIVE.size;
    console.log(`✓ tokens ${flag('check') ? 'checked' : 'written'}: ${n} tokens, ${brandIds.length} brands (${brandIds.join(', ')}), ${rows.length} contrast pairs AA`);
} catch (e) { console.error('✗ ' + e.message); process.exit(1); }
