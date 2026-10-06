#!/usr/bin/env node
// Feeds UI i18n helper.
//   node scripts/feed-i18n.mjs extract            list every translatable Feeds string (JSON on stdout)
//   node scripts/feed-i18n.mjs merge <dir>        merge <dir>/<locale>.json ({english: translation}) into _locales
//   node scripts/feed-i18n.mjs check              coverage per locale + length flags (writes scripts/feed-i18n-report.md)
// Strings live in the code as T('English'), TN(n, 'one', 'other'), TU('Caption'), N_('English') and as
// data-i18n* attributes in popup.html. The English text is the key (see plugin/src/modules/feedI18n.js).
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'plugin/src');
const LOC = path.join(SRC, '_locales');
const { keyOf } = await import(pathToFileURL(path.join(SRC, 'modules/feedI18n.js')).href);

const FILES = ['feedManager.js', 'feedPlayer.js', 'feedAi.js', 'feedInsights.js', 'feedRollup.js', 'feedMood.js', 'analyticsManager.js', 'moodView.js', 'historyMood.js', 'sendSheet.js', 'digestBuilder.js', 'articleManager.js', 'promptSettings.js'].map(f => path.join(SRC, 'modules', f));
const unq = (q, body) => { try { return new Function('return ' + q + body + q)(); } catch (e) { return null; } };

export function extract() {
    const out = new Set();
    const lit = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|` + '`(?:[^`\\\\]|\\\\.)*`)';
    const re1 = new RegExp(String.raw`\b(?:T|TU|N_)\(\s*` + lit, 'g');                       // T('x') TU('x') N_('x')
    const reN = new RegExp(String.raw`\bTN\([^,]+?,\s*` + lit + String.raw`\s*,\s*` + lit, 'g'); // TN(n, 'one', 'other')
    const val = (s) => unq(s[0], s.slice(1, -1));
    for (const f of FILES) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(re1)) { const v = val(m[1]); if (v) out.add(v); }
        for (const m of src.matchAll(reN)) { for (const g of [m[1], m[2]]) { const v = val(g); if (v) out.add(v); } }
    }
    // popup.html: data-i18n / data-i18n-title / data-i18n-aria with an f_ key; English comes from the element itself
    const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
    for (const m of html.matchAll(/<(\w+)([^>]*\sdata-i18n(?:-title|-aria|-placeholder)?="f_[^"]*"[^>]*)>([^<]*)/g)) {
        const attrs = m[2], text = m[3].trim();
        const pick = (a) => (attrs.match(new RegExp('\\s' + a + '="([^"]*)"')) || [])[1];
        const key = (attrs.match(/data-i18n(?:-title|-aria|-placeholder)?="(f_[^"]*)"/) || [])[1];
        const en = /\sdata-i18n="f_/.test(attrs) ? text : (/data-i18n-title/.test(attrs) ? pick('title') : /data-i18n-placeholder/.test(attrs) ? pick('placeholder') : pick('aria-label'));
        if (en && keyOf(en) === key) out.add(en);
        else console.error('WARN popup.html: key/text mismatch for', key, JSON.stringify(en));
    }
    return [...out].sort();
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const locales = () => fs.readdirSync(LOC).filter(d => fs.existsSync(path.join(LOC, d, 'messages.json')));

// Rough display width: CJK / fullwidth count double, emoji ~2, combining marks 0.
function width(s) {
    let w = 0;
    for (const ch of s.replace(/\{[a-z]+\}/g, '00')) {
        const c = ch.codePointAt(0);
        if (c >= 0x300 && c <= 0x36f) continue;
        if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60) || c >= 0x1f300) w += 2; else w += 1;
    }
    return w;
}
// Tight spots (buttons, chips, segmented control, captions) get a stricter budget than prose.
const budget = (en) => {
    const w = width(en);
    if (w <= 14) return Math.max(w * 1.5, w + 5);
    if (w <= 40) return w * 1.4;
    return w * 1.3;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const cmd = process.argv[2];
    if (cmd === 'extract') console.log(JSON.stringify(extract(), null, 1));
    else if (cmd === 'merge') {
        const dir = path.resolve(process.argv[3]);
        const strings = extract();
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
            const l = f.replace('.json', ''); const p = path.join(LOC, l, 'messages.json');
            if (!fs.existsSync(p)) { console.error('skip unknown locale', l); continue; }
            const tr = readJson(path.join(dir, f)); const msgs = readJson(p); let n = 0;
            for (const en of strings) { const v = tr[en]; if (typeof v === 'string' && v.trim()) { msgs[keyOf(en)] = { message: v }; n++; } }
            fs.writeFileSync(p, JSON.stringify(msgs, null, 2) + '\n'); console.log(l, 'merged', n, '/', strings.length);
        }
        // English: message = source text, so a locale falls back cleanly and translators see the source.
        const pe = path.join(LOC, 'en/messages.json'); const en = readJson(pe);
        for (const s of strings) { const hint = [...new Set(s.match(/\{[a-z]+\}/g) || [])]; en[keyOf(s)] = hint.length ? { message: s, description: 'Placeholders: ' + hint.join(' ') + ' (keep as is)' } : { message: s }; }
        fs.writeFileSync(pe, JSON.stringify(en, null, 2) + '\n');
    } else if (cmd === 'check') {
        const strings = extract(); const lines = []; let bad = 0;
        const en = readJson(path.join(LOC, 'en/messages.json'));
        const missingEn = strings.filter(s => !en[keyOf(s)]); if (missingEn.length) lines.push(`en is missing ${missingEn.length} strings (run merge)`);
        const summary = []; const flagged = [];
        for (const l of locales().filter(l => l !== 'en')) {
            const m = readJson(path.join(LOC, l, 'messages.json'));
            const miss = strings.filter(s => !m[keyOf(s)]);
            const phBad = [], long = [];
            for (const s of strings) {
                const v = m[keyOf(s)]?.message; if (!v) continue;
                const a = (s.match(/\{[a-z]+\}/g) || []).sort().join(), b = (v.match(/\{[a-z]+\}/g) || []).sort().join();
                if (a !== b) phBad.push(s);
                const w = width(v), lim = budget(s);
                if (w > lim) long.push({ en: s, tr: v, w, en_w: width(s), ratio: +(w / width(s)).toFixed(2) });
            }
            summary.push({ l, have: strings.length - miss.length, miss: miss.length, phBad: phBad.length, long: long.length });
            bad += miss.length + phBad.length;
            if (miss.length) lines.push(`### ${l}: ${miss.length} missing\n` + miss.map(s => '- ' + s).join('\n'));
            if (phBad.length) lines.push(`### ${l}: placeholder mismatch\n` + phBad.map(s => '- ' + s).join('\n'));
            flagged.push({ l, long });
        }
        let md = `# Feeds UI translations — coverage & length report\n\nStrings: ${strings.length}. Length budget: ≤14 cols → max(1.5×, +5); ≤40 → 1.4×; longer → 1.3× (CJK/emoji count 2 columns).\n\n| locale | translated | missing | placeholder errors | too long |\n|---|---|---|---|---|\n`;
        for (const s of summary) md += `| ${s.l} | ${s.have} | ${s.miss} | ${s.phBad} | ${s.long} |\n`;
        md += '\n## Over-long translations (check these in the UI)\n';
        for (const { l, long } of flagged) { if (!long.length) continue; md += `\n### ${l}\n| English | Translation | width | ratio |\n|---|---|---|---|\n`; for (const x of long.sort((a, b) => b.ratio - a.ratio)) md += `| ${x.en.replace(/\|/g, '\\|')} | ${x.tr.replace(/\|/g, '\\|')} | ${x.w} vs ${x.en_w} | ${x.ratio}× |\n`; }
        if (lines.length) md += '\n## Problems\n\n' + lines.join('\n\n') + '\n';
        fs.writeFileSync(path.join(ROOT, 'scripts/feed-i18n-report.md'), md);
        console.table(summary); console.log('report → scripts/feed-i18n-report.md'); process.exitCode = bad ? 1 : 0;
    } else console.log('usage: feed-i18n.mjs extract|merge <dir>|check');
}
