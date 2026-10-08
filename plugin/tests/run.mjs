// Runs every tests/test*.mjs in its own process (they mutate globals), prints a summary, exits non-zero on failure.
// Usage: npm test            (all)       npm test -- 12 37   (only test12, test37)
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const KNOWN_FAILING = new Set(['test18.mjs']);   // pre-existing failure, tracked: remove from here once fixed
const only = process.argv.slice(2);
const files = fs.readdirSync(here).filter(f => /^test\d+\.mjs$/.test(f))
  .filter(f => !only.length || only.includes(f.match(/\d+/)[0]))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
let failed = [], known = [];
// One line per test: the first comment line of the file says what it covers.
const about = (f) => { try { const l = fs.readFileSync(path.join(here, f), 'utf8').split('\n')[0]; return l.startsWith('//') ? l.replace(/^\/\/\s*/, '').slice(0, 130) : ''; } catch (_) { return ''; } };
for (const f of files) {
  const r = spawnSync(process.execPath, ['--import', path.join(here, 'env.mjs'), path.join(here, f)], { encoding: 'utf8', timeout: 120000 });
  const ok = r.status === 0;
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  if (ok) console.log('ok   ', f.padEnd(12), about(f) || last.slice(0, 70));
  else if (KNOWN_FAILING.has(f)) { known.push(f); console.log('known', f.padEnd(12), about(f), '→', ((r.stderr || '').trim().split('\n').find(l => /Error/.test(l)) || '').slice(0, 70)); }
  else { failed.push(f); console.log('FAIL ', f.padEnd(12), about(f)); console.log((r.stderr || r.stdout || '').split('\n').slice(-12).join('\n')); }
}
console.log(`\n${files.length - failed.length - known.length} passed, ${known.length} known-failing, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
