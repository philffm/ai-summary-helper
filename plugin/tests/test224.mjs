// Every bundle the build writes (background workers, content script, finalize) is a valid classic script. The bundler (scripts/build.js) only understands `import { named } from`; a default
// import or a re-export anywhere in a worker's module graph is left in the output and breaks the whole worker, and the build itself stays silent.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-workers-'));
execFileSync('node', [new URL('../scripts/build.js', import.meta.url).pathname, '--bundle', out], { stdio: 'pipe' });
const workers = fs.readdirSync(out).filter(f => /-worker\.js$|^content\.js$|^finalize\.js$/.test(f));   // the content bundler puts all modules into one scope: a name used twice breaks it
assert.ok(workers.length >= 7 && workers.includes('content.js') && workers.includes('finalize.js'), 'the worker bundles are built: ' + workers.join(', '));
for (const f of workers) {
    const code = fs.readFileSync(path.join(out, f), 'utf8');
    try { new vm.Script(code, { filename: f }); } catch (e) { assert.fail(`${f} is not a valid classic script: ${e.message}`); }
    assert.ok(!/^\s*import\s/m.test(code.replace(/\/\*[\s\S]*?\*\//g, '')), `${f} has no leftover import statements`);
}
const mcp = fs.readFileSync(path.join(out, 'mcp-worker.js'), 'utf8');
assert.ok(mcp.includes('related_articles'), 'the MCP worker carries the related_articles tool');
console.log('workers ok: ' + workers.join(', '));
