// Test runner: every tests/test*.mjs in its own process (they mutate globals), in parallel, quiet by default.
//
//   npm test                   only the tests a change can reach (import graph, see affected.mjs), failures + one summary line
//   npm test -- 12 41          only test12 and test41
//   npm test -- --deep         follow every import (popup.js loads the whole app, so most tests are reached); CI pull requests use this
//   npm test -- --all          every feature test (no audits)
//   npm run test:release       everything, including the audits (files whose first lines say `@audit`: project-wide checks such as
//                              the translation coverage). Run before a release; CI does it on main, nightly and on tags.
//   --verbose                  one line per test      --list   show which tests would run and why, then stop
//   --base <ref>               compare with this ref instead of origin/main
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { affectedTests, buildGraph, changedInfo, DEFAULT_DEPTH, htmlImpact, repoFiles } from './affected.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const KNOWN_FAILING = new Set([]);   // tests with a tracked pre-existing failure; keep empty
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const only = args.filter((a) => /^\d+$/.test(a));
const release = flag('--release'), all = flag('--all') || release, verbose = flag('--verbose'), listOnly = flag('--list');
const head = (f) => fs.readFileSync(path.join(here, f), 'utf8').split('\n').slice(0, 3);
const isAudit = (f) => head(f).some((l) => /@audit\b/.test(l));
const isRealtime = (f) => head(f).some((l) => /@realtime\b/.test(l));   // depends on real timing: runs without the timer speed-up

const everyTest = fs.readdirSync(here).filter((f) => /^test\d+\.mjs$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
const audits = new Set(everyTest.filter(isAudit));
let files, why = new Map(), note = '';
if (only.length) files = everyTest.filter((f) => only.includes(f.match(/\d+/)[0]));
else if (all) files = everyTest.filter((f) => release || !audits.has(f));
else {
  const baseIdx = args.indexOf('--base'), info = changedInfo(root, baseIdx >= 0 ? args[baseIdx + 1] : ''), repo = repoFiles(root);
  const changed = [...info.files, ...htmlImpact(root, info.base, info.files, repo).keys()];
  const rel = (f) => 'plugin/tests/' + f;
  const sel = affectedTests(root, changed, everyTest.map(rel), buildGraph(root, repo), flag('--deep') ? Infinity : DEFAULT_DEPTH);
  files = everyTest.filter((f) => sel.tests.has(rel(f)) && !audits.has(f));
  files.forEach((f) => why.set(f, sel.tests.get(rel(f))));
  note = `${changed.length} changed file(s) → ${files.length} of ${everyTest.length - audits.size} tests` + (audits.size ? ` (${audits.size} audit(s) only in test:release)` : '');
}
if (listOnly) { console.log(note || `${files.length} tests`); files.forEach((f) => console.log(f.padEnd(14), why.get(f) || '')); process.exit(0); }
if (!files.length) { console.log(note ? `${note}. Nothing to run.` : 'No tests selected.'); process.exit(0); }

// One line per test in --verbose: the first comment line of the file says what it covers.
const about = (f) => { try { const l = fs.readFileSync(path.join(here, f), 'utf8').split('\n')[0]; return l.startsWith('//') ? l.replace(/^\/\/\s*/, '').replace(/@(audit|realtime)\s*/g, '').slice(0, 130) : ''; } catch (_) { return ''; } };
const runOne = (f) => new Promise((resolve) => {
  const started = Date.now();
  const p = spawn(process.execPath, ['--import', path.join(here, 'env.mjs'), path.join(here, f)], { timeout: 120000, env: { ...process.env, ...(isRealtime(f) ? { AISH_TEST_SPEED: '1' } : {}) } });
  let out = '', err = '';
  p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => err += d);
  p.on('close', (status) => resolve({ f, status, stdout: out, stderr: err, ms: Date.now() - started }));
});
const t0 = Date.now();
const results = new Array(files.length);
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length, files.length)) }, async () => {
  while (next < files.length) { const i = next++; results[i] = await runOne(files[i]); }
}));

const failed = [], known = [];
for (const r of results) {
  const f = r.f, ok = r.status === 0;
  if (ok) { if (verbose) console.log('ok   ', f.padEnd(12), String((r.ms / 1000).toFixed(1)).padStart(5) + 's', about(f)); continue; }
  if (KNOWN_FAILING.has(f)) { known.push(f); console.log('known', f.padEnd(12), about(f)); continue; }
  failed.push(f);
  console.log('FAIL ', f.padEnd(12), about(f));
  console.log((r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-12).join('\n'));
}
if (note) console.log(note);
console.log(`${files.length - failed.length - known.length} passed, ${known.length} known-failing, ${failed.length} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
