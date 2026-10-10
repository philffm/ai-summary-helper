#!/usr/bin/env node
// Release notes from the commit messages between two versions (not from issues or pull requests).
//
//   node scripts/changelog.mjs --version 2.2.4                 print the notes (markdown) for v2.2.4
//   node scripts/changelog.mjs --version 2.2.4 --write         also put the release into CHANGELOG.md
//   node scripts/changelog.mjs --version 2.2.4 --notes out.md  also write the notes to a file (GitHub release body)
//   --from <tag|ref>   start after this ref (default: the highest v* tag below --version, else the first commit)
//   --to <ref>         end at this ref (default HEAD)
//
// Commit convention (see CONTRIBUTING.md): "Scope: what changed" and optional "- detail" lines in the body.
// The subject becomes the entry, the bullet lines become its sub-points. Bot version bumps, merge commits and
// non-descriptive subjects ("up", "wip") are left out and counted.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_SCOPES = /^(tests?|ci|build|docs?|size|chore|refactor|deps|lint|release)$/i;
const NOISE = /^(up|wip|tmp|temp|fix|update|\.+)$/i;
const ORDER = ['Added', 'Changed', 'Fixed', 'Developer experience'];

/** git log text → [{ subject, bullets, author }] for the commits worth listing, plus how many were skipped. */
export function parseCommits(raw) {
    const out = [];
    let skipped = 0;
    for (const rec of String(raw).split('\x1e')) {
        const r = rec.replace(/^\n+/, '');
        if (!r.trim()) continue;
        const [, author = '', subject = '', body = ''] = r.split('\x1f');
        const s = subject.trim();
        if (/^chore: bump version/i.test(s) || /\[skip ci\]/i.test(s) || /^github-actions/i.test(author)) continue;
        if (/^merge (branch|pull request|remote)/i.test(s)) continue;
        if (!s || NOISE.test(s)) { skipped++; continue; }
        // "- detail" lines are bullets; an indented line right after one continues it (hard-wrapped commit bodies).
        const bullets = [];
        for (const line of body.split('\n')) {
            if (/^\s{0,1}[-*]\s+/.test(line)) bullets.push(line.replace(/^\s*[-*]\s+/, '').trim());
            else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ' ' + line.trim();
            else if (!line.trim()) continue;
        }
        out.push({ subject: s, bullets, author: author.trim() });
    }
    return { commits: out, skipped };
}

/** "Scope: text" → which group it belongs to. */
export function classify(subject) {
    const m = subject.match(/^([A-Za-z][\w &/-]{0,24}):\s+(.*)$/);
    const scope = m ? m[1] : '';
    const text = m ? m[2] : subject;
    if (DEV_SCOPES.test(scope)) return 'Developer experience';
    if (/^fix(es|ed)?\b/i.test(text) || /^fix(es|ed)?\b/i.test(subject) || /\b(fixes|fixed|bug)\b/i.test(subject)) return 'Fixed';
    if (/^(add|added|new|introduce)\b/i.test(text) || /^(add|added|new)\b/i.test(subject)) return 'Added';
    return 'Changed';
}

/** Markdown body for a set of commits: groups in a fixed order, one bullet per commit with its detail lines. */
export function renderGroups(commits, level = 3) {
    const groups = new Map(ORDER.map((g) => [g, []]));
    for (const c of commits) groups.get(classify(c.subject)).push(c);
    const lines = [];
    for (const g of ORDER) {
        const list = groups.get(g);
        if (!list.length) continue;
        lines.push(`${'#'.repeat(level)} ${g}`, '');
        for (const c of list) {
            lines.push(`- ${c.subject}`);
            c.bullets.forEach((b) => lines.push(`  - ${b}`));
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}

/** Put a release into CHANGELOG.md. A hand-written "Unreleased" section is kept and becomes the release;
 *  the generated commit list goes under "Commit log" in it. Without one, a new section is inserted on top. */
export function insertRelease(md, version, date, generated) {
    if (new RegExp(`^## v?${version.replace(/\./g, '\\.')}\\b`, 'm').test(md)) return md;   // already there
    const head = `## ${version} (${date})`;
    const u = md.search(/^## Unreleased\s*$/m);
    if (u >= 0) {
        const after = md.slice(u).replace(/^## Unreleased\s*\n/, '');
        const next = after.search(/^## /m);
        const body = (next >= 0 ? after.slice(0, next) : after).trim();
        const rest = next >= 0 ? after.slice(next) : '';
        const log = generated ? `\n\n### Commit log\n\n${generated.replace(/^### /gm, '#### ')}` : '';
        return `${md.slice(0, u)}## Unreleased\n\n${head}\n\n${body}${log}\n\n${rest}`.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
    }
    const first = md.search(/^## /m);
    const section = `${head}\n\n${generated || '_No changes recorded in commit messages._'}\n\n`;
    return first >= 0 ? md.slice(0, first) + section + md.slice(first) : md.replace(/\n*$/, '\n\n') + section;
}

const semver = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Highest v* tag strictly below `version`, or '' when there is none. */
export function previousTag(tags, version) {
    return tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && cmp(t, version) < 0).sort(cmp).pop() || '';
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function notesFor(version, { from = '', to = 'HEAD' } = {}) {
    const start = from || previousTag(git('tag', '--list', 'v[0-9]*').split('\n').filter(Boolean), version);
    const range = start ? `${start}..${to}` : to;
    const raw = git('log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', range);
    const { commits, skipped } = parseCommits(raw);
    const date = new Date().toISOString().slice(0, 10);
    const groups = renderGroups(commits);
    const foot = skipped ? `\n\n_${skipped} commit${skipped === 1 ? '' : 's'} without a descriptive message left out._` : '';
    return { start, date, commits, groups, markdown: `${groups || '_No changes recorded in commit messages._'}${foot}`, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };
    const version = opt('--version') || JSON.parse(fs.readFileSync(path.join(ROOT, 'current_version.json'), 'utf8')).version;
    const { start, date, groups, markdown } = notesFor(version, { from: opt('--from'), to: opt('--to') || 'HEAD' });
    const heading = `## ${version}${start ? ` (since ${start})` : ''}\n\n`;
    if (opt('--notes')) fs.writeFileSync(path.resolve(opt('--notes')), `${heading}${markdown}\n`);
    if (args.includes('--write')) {
        const file = path.join(ROOT, 'CHANGELOG.md');
        fs.writeFileSync(file, insertRelease(fs.readFileSync(file, 'utf8'), version, date, groups));
    }
    if (!opt('--notes') && !args.includes('--write')) console.log(`${heading}${markdown}`);
}
