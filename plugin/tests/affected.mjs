// affected.mjs — which tests can a change reach?
//
// Every test file is a node in a graph: a test points at the files it names (imp('modules/x.js'), fs.readFileSync('…/popup.html'), a spawned
// script …), and each source file points at the files it imports or names. A test is "affected" when a changed file is anywhere in its
// closure. Files are matched by basename against the repository's file list, which can only over-select (safe), never miss a dependency.
//
// Usage from run.mjs; also unit-tested by test107.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as acorn from 'acorn';

const FILE_TOKEN = /[\w@.\-/]+\.(?:mjs|cjs|js|html|css|json|md|sh)\b/g;
const SKIP_DIR = /^(node_modules|docs|plugin\/dev|plugin\/prod|plugin\/dist|\.git)\//;

/** Tracked + untracked files (repo-relative, forward slashes). */
export function repoFiles(root) {
    const git = (a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout || '';
    const list = [...git(['ls-files']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')];
    return [...new Set(list.filter(Boolean))].filter((f) => !SKIP_DIR.test(f) && fs.existsSync(path.join(root, f)));
}

/** basename → [repo-relative paths] */
export function indexByBasename(files) {
    const idx = new Map();
    for (const f of files) { const b = path.basename(f); if (!idx.has(b)) idx.set(b, []); idx.get(b).push(f); }
    return idx;
}

/** The string / template literals of a script, without its comments (a comment that mentions "feedManager.js" is not a dependency). */
export function stringLiterals(text) {
    for (const sourceType of ['module', 'script']) {
        try {
            const out = [];
            for (const t of acorn.tokenizer(text, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true })) {
                if (t.type.label === 'string' || t.type.label === 'template') out.push(String(t.value));
            }
            return out.join('\n');
        } catch (e) { /* try the other mode */ }
    }
    return text;   // not parseable: fall back to the raw text (over-selects, never misses)
}

/** Files a source text names (imports, dynamic imports, readFileSync/getURL strings …). */
export function referencedFiles(text, idx, self) {
    const out = new Set();
    for (const m of stringLiterals(text).match(FILE_TOKEN) || []) {
        const base = path.basename(m);
        for (const f of idx.get(base) || []) if (f !== self) out.add(f);
    }
    return out;
}

/**
 * file → Set(files it references). Only code (.js / .mjs / .cjs / .sh) has outgoing edges: an HTML page, a stylesheet or a JSON file does not
 * *run* the files it links to in a test. The test harness loads popup.html as a DOM only, so that edge is dropped as well; HTML changes reach
 * the code through the element ids they add or remove (see htmlImpact).
 */
export function buildGraph(root, files = repoFiles(root)) {
    const idx = indexByBasename(files);
    const graph = new Map();
    for (const f of files) {
        if (!/\.(mjs|cjs|js|html|css|json|md|sh)$/.test(f)) continue;
        if (/^plugin\/src\/_locales\//.test(f) || /\.min\.js$/.test(f) || /^plugin\/src\/lib\//.test(f)) { graph.set(f, new Set()); continue; }
        let text = '';
        try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { /* unreadable → no edges */ }
        if (!/\.(m?js|cjs|sh)$/.test(f) || text.length > 400000) { graph.set(f, new Set()); continue; }
        const refs = referencedFiles(text, idx, f);
        if (f === 'plugin/tests/harness.mjs') for (const r of [...refs]) if (/\.html$/.test(r)) refs.delete(r);
        graph.set(f, refs);
    }
    return graph;
}

/** Everything reachable from `start` (including itself) within `maxDepth` hops. */
export function closure(graph, start, maxDepth = Infinity) {
    const seen = new Set([start]);
    let level = [start];
    for (let d = 0; d < maxDepth && level.length; d++) {
        const nextLevel = [];
        for (const f of level) for (const n of graph.get(f) || []) if (!seen.has(n)) { seen.add(n); nextLevel.push(n); }
        level = nextLevel;
    }
    return seen;
}

/** Default reach while developing: the test, the modules it loads, and what those load. `--deep` follows everything (popup.js loads the whole app). */
export const DEFAULT_DEPTH = 2;

/** Changes that can affect any test: the runner itself and the shared test plumbing. */
export const EVERYTHING = [/^plugin\/tests\/(run|affected|env|harness)\.mjs$/, /^package(-lock)?\.json$/, /^eslint\.config\.mjs$/];

/**
 * The tests (repo-relative test paths) a set of changed files can reach.
 * Returns { tests: Map(testPath → why), all: boolean }.
 */
export function affectedTests(root, changed, testFiles, graph = buildGraph(root), depth = DEFAULT_DEPTH) {
    const why = new Map();
    if (changed.some((f) => EVERYTHING.some((re) => re.test(f)))) return { tests: new Map(testFiles.map((t) => [t, 'shared test setup changed'])), all: true };
    const changedSet = new Set(changed.filter((f) => !/^plugin\/src\/_locales\//.test(f)));   // translations are an audit (test:release)
    for (const t of testFiles) {
        if (changedSet.has(t)) { why.set(t, 'the test itself changed'); continue; }
        const hit = [...closure(graph, t, depth)].find((f) => f !== t && changedSet.has(f));
        if (hit) why.set(t, hit);
    }
    return { tests: why, all: false };
}

/** Files changed on this branch: since the merge-base with origin/main (or the upstream), plus working tree and untracked files. */
export function changedFiles(root, baseRef) { return changedInfo(root, baseRef).files; }

/** { files, base }: see changedFiles; base is the commit everything is compared with ('' when unknown). */
export function changedInfo(root, baseRef = '') {
    const git = (a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    const ok = (a) => git(a).status === 0;
    let base = '';
    for (const ref of baseRef ? [baseRef] : ['origin/main', '@{u}']) {
        if (!ok(['rev-parse', '--verify', ref])) continue;
        const mb = git(['merge-base', 'HEAD', ref]);
        if (mb.status === 0 && mb.stdout.trim()) { base = mb.stdout.trim(); break; }
    }
    if (!base && ok(['rev-parse', '--verify', 'HEAD~1'])) base = 'HEAD~1';
    const lines = [base ? git(['diff', '--name-only', `${base}...HEAD`]).stdout : '', git(['diff', '--name-only', 'HEAD']).stdout, git(['ls-files', '--others', '--exclude-standard']).stdout].join('\n');
    return { files: [...new Set(lines.split('\n').map((s) => s.trim()).filter(Boolean))], base };
}

const ID_ATTR = /\bid="([^"]+)"/g;
/**
 * Changed HTML reaches the code through its element ids: for every id on an added or removed line, the source files that use that id
 * count as changed too (a brand-new id that no code uses yet selects nothing extra).
 */
export function htmlImpact(root, base, changed, files = repoFiles(root)) {
    const htmls = changed.filter((f) => /^plugin\/src\/.*\.html$/.test(f));
    if (!htmls.length) return new Map();
    const ids = new Set();
    for (const h of htmls) {
        const d = spawnSync('git', ['diff', '-U0', ...(base ? [base] : []), '--', h], { cwd: root, encoding: 'utf8' }).stdout || '';
        for (const line of d.split('\n')) if (/^[+-](?![+-])/.test(line)) for (const m of line.matchAll(ID_ATTR)) ids.add(m[1]);
    }
    const impact = new Map();
    for (const f of files.filter((x) => /^plugin\/src\/.*\.js$/.test(x) && !/\/lib\//.test(x))) {
        let text = ''; try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
        const hit = [...ids].find((id) => text.includes(`'${id}'`) || text.includes(`"${id}"`) || text.includes(`#${id}`));
        if (hit) impact.set(f, `popup.html id "${hit}"`);
    }
    return impact;
}
