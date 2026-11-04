#!/usr/bin/env node
// design-system/lint.mjs — motion and breakpoint rules for component CSS (ADR 0005). Part of `npm run tokens:check`.
//   • transition / animation durations under 600 ms come from --duration-* tokens (loops and ambient motion may stay literal;
//     0.001–0.01 ms is "off" and allowed);
//   • every px width in @media / @container queries is a --bp-* token of that context (max-width may be the token − 1px),
//     or listed in config.json › offScaleBreakpoints (a shrinking list of old values; a new one fails);
//   • plugin/src/modules/breakpoints.js FALLBACK equals the app breakpoint tokens.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DS, '..');
const config = JSON.parse(readFileSync(join(DS, 'config.json'), 'utf8'));
const problems = [];
const bpOf = (ctx) => {
  const j = JSON.parse(readFileSync(join(DS, `tokens/${ctx}/base.json`), 'utf8'));
  return Object.fromEntries(Object.entries(j[ctx].semantic.breakpoint || {}).map(([k, v]) => [k.replace(/^bp-/, ''), parseFloat(v.$value)]));
};
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const targets = [['plugin/src/styles.css', 'app'], ['docs/assets/styles.css', 'site']];
let durations = 0, queries = 0, offScale = 0;
for (const [file, ctx] of targets) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  // blank out generated regions and comments, keep offsets for line numbers
  const css = raw.replace(/\/\* @tokens:start [\w-]+ \*\/[\s\S]*?\/\* @tokens:end [\w-]+ \*\//g, (m) => m.replace(/[^\n]/g, ' '))
                 .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of css.matchAll(/(?<![\w-])(transition|transition-duration|animation|animation-duration)\s*:([^;{}]*)/g)) {
    // per comma-separated item only the first time is the duration; a second one is the delay (allowed as a literal)
    for (const item of m[2].replace(/\([^()]*\)/g, (p) => p.replace(/,/g, ' ')).split(',')) {
      const d = item.match(/var\(--duration-[\w-]+\)|(?<![\w.-])(\d*\.?\d+)(ms|s)\b/);
      if (!d || d[0].startsWith('var(')) continue;
      const ms = parseFloat(d[1]) * (d[2] === 's' ? 1000 : 1);
      if (ms > 0.01 && ms < 600) problems.push(`${file}:${lineOf(css, m.index)} ${m[1]} uses ${d[0]}: use var(--duration-*)`);
      else durations++;
    }
  }
  const bps = Object.values(bpOf(ctx));
  const allowed = new Set(config.offScaleBreakpoints?.[ctx] || []);
  for (const m of css.matchAll(/@(media|container)[^{]*/g)) {
    for (const w of m[0].matchAll(/(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      queries++;
      const v = parseFloat(w[2]);
      const ok = bps.includes(v) || (w[1] === 'max' && bps.includes(v + 1)) || (w[1] === 'min' && bps.includes(v - 1));
      if (ok) continue;
      if (allowed.has(v) || allowed.has(v - 1) || allowed.has(v + 1)) { offScale++; continue; }
      problems.push(`${file}:${lineOf(css, m.index)} @${m[1]} ${w[1]}-width ${v}px is not a breakpoint token of "${ctx}" (${bps.join(', ')})`);
    }
  }
}
// JS fallback = tokens
const js = readFileSync(join(ROOT, 'plugin/src/modules/breakpoints.js'), 'utf8');
const fb = Object.fromEntries([...js.matchAll(/'([\w-]+)':\s*(\d+)/g)].map((m) => [m[1], +m[2]]));
const app = bpOf('app');
for (const [k, v] of Object.entries(app)) if (fb[k] !== v) problems.push(`plugin/src/modules/breakpoints.js FALLBACK['${k}'] is ${fb[k]}, token --bp-${k} is ${v}px`);
for (const k of Object.keys(fb)) if (!(k in app)) problems.push(`plugin/src/modules/breakpoints.js FALLBACK['${k}'] has no token`);
if (problems.length) { for (const p of problems) console.error('✗ ' + p); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log(`✓ motion and breakpoints checked: ${queries} width queries (${offScale} on the off-scale list), literal durations only for loops (${durations})`);
