#!/usr/bin/env node
// Single source of truth for the privacy policy: site-src/pages/privacy.html.
// This writes the Markdown copies that ship with the repo and the extension:
//   privacy.md              (repo root)
//   plugin/src/privacy.md   (bundled into the extension package)
//
//   node scripts/privacy-md.mjs          write both files
//   node scripts/privacy-md.mjs --check  exit 1 when a file is out of date (used by the test-suite)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'site-src/pages/privacy.html');
const TARGETS = [path.join(ROOT, 'privacy.md'), path.join(ROOT, 'plugin/src/privacy.md')];

const inline = ($, node) => $(node).contents().toArray().map((c) => {
    if (c.type === 'text') return c.data.replace(/\s+/g, ' ');
    const el = $(c); const inner = inline($, c);
    switch (c.tagName) {
        case 'strong': case 'b': return `**${inner.trim()}**`;
        case 'em': case 'i': return `_${inner.trim()}_`;
        case 'code': return '`' + el.text() + '`';
        case 'a': { const href = el.attr('href') || ''; return href && !href.startsWith('#') ? `[${inner.trim()}](${href})` : inner; }
        case 'br': return '\n';
        default: return inner;
    }
}).join('');

const clean = (s) => s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
const cell = (s) => clean(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function render() {
    const $ = cheerio.load(fs.readFileSync(SOURCE, 'utf8'));
    const lines = ['# Privacy Policy', '', '**AI Summary Helper**', '',
        '<!-- Generated from site-src/pages/privacy.html by scripts/privacy-md.mjs. Edit the HTML, not this file. -->', ''];
    $('.prose').children().each((_, node) => {
        const tag = node.tagName;
        const el = $(node);
        if (tag === 'h2') lines.push(`## ${clean(inline($, node))}`, '');
        else if (tag === 'h3') lines.push(`### ${clean(inline($, node))}`, '');
        else if (tag === 'p') { const t = clean(inline($, node)); if (t) lines.push(t, ''); }
        else if (tag === 'ul') { el.children('li').each((__, li) => lines.push(`- ${clean(inline($, li))}`)); lines.push(''); }
        else if (tag === 'table') {
            const head = el.find('thead th').toArray().map((th) => cell(inline($, th)));
            lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
            el.find('tbody tr').each((__, tr) => lines.push(`| ${$(tr).children('td').toArray().map((td) => cell(inline($, td))).join(' | ')} |`));
            lines.push('');
        }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const out = render();
    if (process.argv.includes('--check')) {
        const stale = TARGETS.filter((t) => !fs.existsSync(t) || fs.readFileSync(t, 'utf8') !== out);
        if (stale.length) { console.error('Out of date (run: node scripts/privacy-md.mjs):\n' + stale.map((t) => ' - ' + path.relative(ROOT, t)).join('\n')); process.exit(1); }
        console.log('privacy.md copies are in sync');
    } else {
        for (const t of TARGETS) fs.writeFileSync(t, out);
        console.log('wrote', TARGETS.map((t) => path.relative(ROOT, t)).join(', '));
    }
}
