#!/usr/bin/env node
// Checks the libraries vendored by hand in plugin/src/lib/. npm audit can't see them because they aren't
// npm dependencies, which is how pdf.js 4.0.379 sat unpatched behind CVE-2024-4367.
//
// The version table in plugin/src/lib/THIRD_PARTY_LICENSES.md is the source of truth. For each library:
//   1. consistency (offline): the version embedded in the file(s) matches the table (and the readme table),
//   2. advisories: npm's advisory database lists a known vulnerability for that version,
//   3. updates: npm has a newer release.
//
//   node scripts/check-vendored-libs.mjs             print the report (exit 1 only on a consistency error)
//   node scripts/check-vendored-libs.mjs --offline   only step 1: the fast pull-request check
//   node scripts/check-vendored-libs.mjs --strict    also exit 1 when a vendored version has an advisory
//   node scripts/check-vendored-libs.mjs --issue     open/update one GitHub issue (needs `gh` + issues: write);
//                                                    closes it again once everything is clean
//   node scripts/check-vendored-libs.mjs --json      machine-readable result
//
// Adding a library: add a row to the THIRD_PARTY_LICENSES.md table, then an entry in LIBS below.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(root, 'plugin/src/lib');
const LICENSES = path.join(LIB, 'THIRD_PARTY_LICENSES.md');
const README = path.join(root, 'readme.md');
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline'), STRICT = args.has('--strict'), ISSUE = args.has('--issue'), JSON_OUT = args.has('--json');

/**
 * row:     regex on a markdown table row; group 1 = version (first matching row wins)
 * readme:  check the same row in readme.md's third-party table too
 * files:   { file, re } extracts the embedded version (group 1); { file, contains: true } only requires the
 *          documented version to appear as a string literal (for builds without a stable variable name)
 * updates: 'report' lists newer releases; 'quiet' skips them (icon sets release weekly and carry no risk)
 */
const LIBS = [
    {
        name: 'pdf.js', npm: 'pdfjs-dist', row: /^\| pdf\.js[^|]*\| (\d+\.\d+\.\d+) \|/m, readme: true, updates: 'report',
        files: [
            { file: 'pdf.mjs', re: /apiVersion\s*[:=]\s*"(\d+\.\d+\.\d+)"/ },
            { file: 'pdf.worker.mjs', contains: true },
            { file: 'jbig2_nowasm_fallback.js' }, { file: 'openjpeg_nowasm_fallback.js' },   // ship with pdf.js; existence only
        ],
        note: 'Use the minified *legacy* build (Safari). See the build note in THIRD_PARTY_LICENSES.md.',
    },
    {
        name: 'D3.js', npm: 'd3', row: /^\| D3\.js \| (\d+\.\d+\.\d+) \|/m, readme: true, updates: 'report',
        files: [{ file: 'd3.min.js', re: /\bversion="(\d+\.\d+\.\d+)"/ }],
    },
    {
        name: 'qrcode-generator', npm: 'qrcode-generator', row: /^\| qrcode-generator[^|]*\| (\d+\.\d+\.\d+) \|/m, readme: true, updates: 'report',
        files: [{ file: 'qrcode.js', re: /qrcode-generator (\d+\.\d+\.\d+)/ }],
        note: 'The vendored copy has its UMD footer replaced by an ES export (see the file header).',
    },
    {
        name: 'Lucide (icon sprite)', npm: 'lucide-static', row: /^\| Lucide[^|]*\| (\d+\.\d+\.\d+) \|/m, readme: false, updates: 'quiet',
        files: [],   // inline SVG subset in popup.html, no file to compare
    },
    // AFINN-111 is a word list with no release versions: nothing to check.
];

const read = (f) => fs.readFileSync(f, 'utf8');
const errors = [];      // consistency problems: always a failure
const libs = [];

const licenses = read(LICENSES), readme = read(README);
for (const lib of LIBS) {
    const r = { name: lib.name, npm: lib.npm, version: null, advisories: [], latest: null, problems: [] };
    libs.push(r);
    const m = lib.row.exec(licenses);
    if (!m) { errors.push(`${lib.name}: no version row in THIRD_PARTY_LICENSES.md`); continue; }
    r.version = m[1];
    if (lib.readme) {
        const rm = lib.row.exec(readme);
        if (!rm) errors.push(`${lib.name}: no row in readme.md's third-party table`);
        else if (rm[1] !== r.version) errors.push(`${lib.name}: readme.md says ${rm[1]}, THIRD_PARTY_LICENSES.md says ${r.version}`);
    }
    for (const f of lib.files) {
        const p = path.join(LIB, f.file);
        if (!fs.existsSync(p)) { errors.push(`${lib.name}: lib/${f.file} is missing`); continue; }
        if (!f.re && !f.contains) continue;
        const src = read(p);
        if (f.contains) {
            if (!src.includes(`"${r.version}"`)) errors.push(`${lib.name}: lib/${f.file} does not contain version "${r.version}" (replaced without updating the table, or mixed builds?)`);
            continue;
        }
        const fm = f.re.exec(src);
        if (!fm) errors.push(`${lib.name}: can't find the version in lib/${f.file} (update the pattern in scripts/check-vendored-libs.mjs)`);
        else if (fm[1] !== r.version) errors.push(`${lib.name}: lib/${f.file} is ${fm[1]}, THIRD_PARTY_LICENSES.md says ${r.version}`);
    }
}

// ── npm registry ─────────────────────────────────────────────
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
async function getJson(url, init) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
}

let networkError = null;
if (!OFFLINE) {
    const known = libs.filter((l) => l.version);
    try {
        // The same endpoint `npm audit` uses: { pkg: [versions] } → advisories that affect those versions.
        const adv = await getJson('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(known.map((l) => [l.npm, [l.version]]))),
        });
        for (const l of known) l.advisories = (adv[l.npm] || []).map((a) => ({ title: a.title, severity: a.severity, url: a.url, vulnerable: a.vulnerable_versions }));
        await Promise.all(known.map(async (l) => { l.latest = (await getJson(`https://registry.npmjs.org/${l.npm}/latest`)).version; }));
    } catch (e) { networkError = String(e.message || e); }
    for (const l of known) {
        const def = LIBS.find((d) => d.name === l.name);
        if (l.advisories.length) l.problems.push('advisory');
        if (l.latest && cmp(l.latest, l.version) > 0 && def.updates === 'report') l.problems.push(l.latest.split('.')[0] !== l.version.split('.')[0] ? 'major-update' : 'update');
    }
}

// ── report ───────────────────────────────────────────────────
const vulnerable = libs.filter((l) => l.problems.includes('advisory'));
const outdated = libs.filter((l) => l.problems.some((p) => p.endsWith('update')));
const ICON = { advisory: '🔴', 'major-update': '🟡', update: '🟢' };

function markdown() {
    const out = [];
    if (errors.length) out.push('### Consistency errors', '', ...errors.map((e) => `- ❌ ${e}`), '');
    out.push('| Library | Vendored | Latest on npm | Status |', '| --- | --- | --- | --- |');
    for (const l of libs) {
        const status = !l.version ? '❌ not documented'
            : l.problems.length ? l.problems.map((p) => `${ICON[p]} ${p.replace('-', ' ')}`).join(', ')
            : OFFLINE || networkError ? '(not checked)'
            : l.latest && cmp(l.latest, l.version) > 0 ? '✅ no advisories (updates not tracked)'
            : '✅ current, no advisories';
        out.push(`| ${l.name} (\`${l.npm}\`) | ${l.version || '?'} | ${l.latest || '—'} | ${status} |`);
    }
    for (const l of vulnerable) {
        out.push('', `### 🔴 ${l.name} ${l.version}: known vulnerabilities`, '');
        for (const a of l.advisories) out.push(`- **${a.severity}**: [${a.title}](${a.url}) (affects \`${a.vulnerable}\`)`);
    }
    if (vulnerable.length || outdated.length) {
        out.push('', '### How to update', '',
            '1. Get the new build from the npm package (`npm pack <package>@<version>`, then copy the files listed in `THIRD_PARTY_LICENSES.md`).',
            '2. Update the version in the `THIRD_PARTY_LICENSES.md` table and in `readme.md`.',
            '3. Run `node scripts/check-vendored-libs.mjs --offline`, `npm test` and a manual check of the feature.');
        for (const l of [...vulnerable, ...outdated]) { const n = LIBS.find((d) => d.name === l.name).note; if (n) out.push(`- ${l.name}: ${n}`); }
    }
    if (networkError) out.push('', `⚠️ npm registry not reachable, advisories and updates not checked: ${networkError}`);
    return out.join('\n');
}

const report = markdown();
if (JSON_OUT) console.log(JSON.stringify({ errors, libs, networkError }, null, 2));
else console.log(report);

// ── GitHub issue (CI) ───────────────────────────────────────
if (ISSUE) {
    const TITLE = 'Vendored libraries need attention (plugin/src/lib)';
    const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' });
    const run = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '(local run)';
    const found = JSON.parse(gh('issue', 'list', '--state', 'open', '--search', `"${TITLE}" in:title`, '--json', 'number,title,body') || '[]').find((i) => i.title === TITLE);
    const needsIssue = errors.length || vulnerable.length || outdated.length;
    const body = `Found by \`scripts/check-vendored-libs.mjs\` (scheduled CI). This issue is updated in place and closed automatically once everything is clean.\n\n${report}\n\nLast checked: ${run}`;
    if (networkError) console.log('registry not reachable: issue left unchanged');
    else if (needsIssue && !found) {
        try { gh('label', 'create', 'dependencies', '--color', '0366d6', '--description', 'Dependency updates'); } catch { /* exists */ }
        console.log(gh('issue', 'create', '--title', TITLE, '--label', 'dependencies', '--body', body).trim());
    } else if (needsIssue && found) {
        // Edit instead of commenting, so a nightly run doesn't notify anyone until something changes.
        const strip = (s) => s.replace(/\n\nLast checked: .*$/s, '');
        if (strip(found.body) !== strip(body)) { gh('issue', 'edit', String(found.number), '--body', body); console.log(`updated #${found.number}`); }
        if (vulnerable.length && !/🔴/.test(found.body)) gh('issue', 'comment', String(found.number), '--body', `New advisory for ${vulnerable.map((l) => `${l.name} ${l.version}`).join(', ')}. See the updated description.`);
    } else if (found) {
        gh('issue', 'close', String(found.number), '--comment', `All vendored libraries are current and have no known advisories. ${run}`);
        console.log(`closed #${found.number}`);
    }
}

process.exit(errors.length || (STRICT && vulnerable.length) ? 1 : 0);
