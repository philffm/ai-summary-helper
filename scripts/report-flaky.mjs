#!/usr/bin/env node
// Turns the flaky-test list written by plugin/tests/run.mjs (AISH_FLAKY_FILE) into GitHub issues, one per test:
// an open issue "Flaky test: testNN.mjs" gets a comment with the run link, otherwise one is opened (label `flaky`).
// Runs only in CI on main/nightly (not on pull requests); needs `gh` and a token with issues: write.
//
//   node scripts/report-flaky.mjs flaky-tests.json          report
//   node scripts/report-flaky.mjs flaky-tests.json --dry    print what would happen
import fs from 'fs';
import { execFileSync } from 'child_process';

const file = process.argv[2], dry = process.argv.includes('--dry');
if (!file || !fs.existsSync(file)) { console.log('No flaky-test list, nothing to report.'); process.exit(0); }
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!list.length) process.exit(0);

const run = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '(local run)';
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
const title = (t) => `Flaky test: ${t.test}`;

if (!dry) { try { gh('label', 'create', 'flaky', '--color', 'fbca04', '--description', 'Test that failed once and passed on retry'); } catch { /* exists */ } }
for (const t of list) {
  const body = `**${t.test}** — ${t.about}\n\nFailed once and passed on the automatic retry.\nRun: ${run}\n\n\`\`\`\n${t.error}\n\`\`\``;
  if (dry) { console.log(`[dry] ${title(t)}\n${body}\n`); continue; }
  const found = JSON.parse(gh('issue', 'list', '--state', 'open', '--label', 'flaky', '--search', `"${title(t)}" in:title`, '--json', 'number,title') || '[]')
    .find((i) => i.title === title(t));
  if (found) { gh('issue', 'comment', String(found.number), '--body', body); console.log(`commented on #${found.number}: ${title(t)}`); }
  else { console.log(gh('issue', 'create', '--title', title(t), '--label', 'flaky', '--body', body).trim()); }
}
