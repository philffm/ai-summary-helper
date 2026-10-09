// Test runner internals: which tests a change can reach (import graph without comments, depth limit, HTML ids, shared setup, audits skipped for translations).
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { stringLiterals, referencedFiles, indexByBasename, buildGraph, closure, affectedTests, htmlImpact, DEFAULT_DEPTH } from './affected.mjs';

// comments are not dependencies, strings are
const lit = stringLiterals(`// see feedManager.js\nimport x from './modules/a.js'; /* b.js */ const s = "c.html"; const t = \`d.css\`;`);
assert(/a\.js/.test(lit) && /c\.html/.test(lit) && /d\.css/.test(lit) && !/feedManager/.test(lit) && !/b\.js/.test(lit), lit);
const idx = indexByBasename(['plugin/src/modules/a.js', 'plugin/src/modules/b.js', 'plugin/src/popup.html']);
assert.deepEqual([...referencedFiles("import './a.js'; // b.js", idx, 'x')], ['plugin/src/modules/a.js']);

// a throw-away repository with real files
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-aff-'));
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
w('plugin/src/modules/leaf.js', 'export const x = 1;');
w('plugin/src/modules/mid.js', "import { x } from './leaf.js'; export const y = x;");
w('plugin/src/modules/top.js', "import { y } from './mid.js'; export const z = y;");
w('plugin/src/modules/ui.js', "export const go = () => document.getElementById('saveBtn');");
w('plugin/src/popup.html', '<button id="saveBtn">Save</button><button id="oldBtn">Old</button>');
w('plugin/src/_locales/de/messages.json', '{}');
w('plugin/tests/harness.mjs', "export const dom = 'popup.html';");
w('plugin/tests/test1.mjs', "import '../src/modules/mid.js';");
w('plugin/tests/test2.mjs', "const m = await imp('modules/top.js');");
w('plugin/tests/test3.mjs', "import fs from 'fs'; fs.readFileSync('popup.html'); // leaf.js");
w('plugin/tests/test4.mjs', "const m = await imp('modules/ui.js');");
const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
git('init', '-q'); git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
const tests = ['plugin/tests/test1.mjs', 'plugin/tests/test2.mjs', 'plugin/tests/test3.mjs', 'plugin/tests/test4.mjs'];
const g = buildGraph(root);
const pick = (changed, depth) => [...affectedTests(root, changed, tests, g, depth).tests.keys()].map((t) => t.match(/test\d/)[0]).sort().join(',');

assert.equal(DEFAULT_DEPTH, 2);
assert.equal(pick(['plugin/src/modules/leaf.js']), 'test1', 'leaf: test1 → mid → leaf is 2 hops; test2 needs 3 (top → mid → leaf); the comment in test3 is no dependency');
assert.equal(pick(['plugin/src/modules/leaf.js'], Infinity), 'test1,test2', '--deep follows every import');
assert.equal(pick(['plugin/src/modules/top.js']), 'test2');
assert.equal(pick(['plugin/src/modules/mid.js']), 'test1,test2', 'mid: test1 imports it, test2 reaches it through top');
assert.equal(pick(['plugin/src/_locales/de/messages.json']), '', 'translations are an audit, not a feature test');
assert.equal(pick(['plugin/tests/test4.mjs']), 'test4', 'a changed test selects itself');
assert.equal(pick(['plugin/tests/harness.mjs']), 'test1,test2,test3,test4', 'shared setup selects everything');
assert.equal(pick(['package.json']), 'test1,test2,test3,test4');
assert.equal(pick(['plugin/src/popup.html']), 'test3', 'only tests that read popup.html themselves (the harness edge is dropped)');

// HTML changes reach the code that uses a changed id
w('plugin/src/popup.html', '<button id="saveBtn" class="x">Save</button><button id="newBtn">New</button>');
const impact = htmlImpact(root, 'HEAD', ['plugin/src/popup.html'], ['plugin/src/modules/ui.js', 'plugin/src/modules/leaf.js']);
assert.deepEqual([...impact.keys()], ['plugin/src/modules/ui.js'], 'saveBtn changed and ui.js uses it; the new id and untouched code select nothing: ' + [...impact.keys()]);
assert.equal(pick(['plugin/src/modules/ui.js']), 'test4');
fs.rmSync(root, { recursive: true, force: true });
console.log('TEST 107 OK'); process.exit(0);
