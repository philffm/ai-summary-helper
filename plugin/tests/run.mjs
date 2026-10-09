// Runs every tests/test*.mjs in its own process (they mutate globals), prints a summary, exits non-zero on failure.
// Usage: npm test            (all, in parallel)   npm test -- 12 37   (only test12, test37)
//        npm test -- --changed   (only tests that mention a module changed since the last push / in the working tree)
import { spawn, spawnSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const KNOWN_FAILING = new Set([]);   // tests with a tracked pre-existing failure; keep empty
const args = process.argv.slice(2);
const changedMode = args.includes('--changed');
const only = args.filter(a => /^\d+$/.test(a));
// Basenames of changed source files (committed since main + staged/unstaged + untracked).
function changedNames() {
  const git = (a) => spawnSync('git', a, { cwd: here, encoding: 'utf8' }).stdout || '';
  const base = ['@{u}', 'HEAD~1'].find(b => spawnSync('git', ['rev-parse', '--verify', b], { cwd: here }).status === 0);
  const list = [base ? git(['diff', '--name-only', `${base}...HEAD`]) : '', git(['diff', '--name-only', 'HEAD']), git(['ls-files', '--others', '--exclude-standard'])].join('\n');
  return [...new Set(list.split('\n').filter(f => /^plugin\/src\/(?!_locales).*\.(m?js|css|html)$/.test(f)).map(f => path.basename(f).replace(/\.[^.]+$/, '')))];
}
const names = changedMode ? changedNames() : [];
const touches = (f) => { const src = fs.readFileSync(path.join(here, f), 'utf8'); return names.some(n => new RegExp(`\\b${n}(\\.\\w+)?['"\`]`).test(src)); };
const files = fs.readdirSync(here).filter(f => /^test\d+\.mjs$/.test(f))
  .filter(f => !only.length || only.includes(f.match(/\d+/)[0]))
  .filter(f => !changedMode || touches(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
let failed = [], known = [];
// One line per test: the first comment line of the file says what it covers.
const about = (f) => { try { const l = fs.readFileSync(path.join(here, f), 'utf8').split('\n')[0]; return l.startsWith('//') ? l.replace(/^\/\/\s*/, '').slice(0, 130) : ''; } catch (_) { return ''; } };
const runOne = (f) => new Promise(resolve => {
  const p = spawn(process.execPath, ['--import', path.join(here, 'env.mjs'), path.join(here, f)], { timeout: 120000 });
  let out = '', err = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', status => resolve({ f, status, stdout: out, stderr: err }));
});
// Parallel pool (each test is its own process); results print in file order afterwards.
const results = new Array(files.length);
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, files.length)) }, async () => {
  while (next < files.length) { const i = next++; results[i] = await runOne(files[i]); }
}));
if (changedMode) console.log(`--changed: ${files.length} test(s) touch ${names.length} changed module(s)`);
for (const r of results) {
  const f = r.f;
  const ok = r.status === 0;
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  if (ok) console.log('ok   ', f.padEnd(12), about(f) || last.slice(0, 70));
  else if (KNOWN_FAILING.has(f)) { known.push(f); console.log('known', f.padEnd(12), about(f), '→', ((r.stderr || '').trim().split('\n').find(l => /Error/.test(l)) || '').slice(0, 70)); }
  else { failed.push(f); console.log('FAIL ', f.padEnd(12), about(f)); console.log((r.stderr || r.stdout || '').split('\n').slice(-12).join('\n')); }
}
console.log(`\n${files.length - failed.length - known.length} passed, ${known.length} known-failing, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
