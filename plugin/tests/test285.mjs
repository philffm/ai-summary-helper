// The background workers are built with our own mini-bundler. Every name one module takes from another must arrive: a re-export
// it did not understand left `esc` empty in the sync worker, and a pull stopped at the first article with questions.
import assert from 'assert'; import fs from 'fs'; import os from 'os'; import path from 'path'; import vm from 'vm'; import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-bundles-'));
try {
    const built = spawnSync('node', [path.join(here, '..', 'scripts', 'build.js'), '--bundle', out], { encoding: 'utf8' });
    assert.equal(built.status, 0, 'the build works: ' + built.stderr);
    const globals = { console, TextEncoder, TextDecoder, URL, URLSearchParams, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa };
    const workers = fs.readdirSync(out).filter((f) => f.endsWith('-worker.js'));
    assert.ok(workers.length >= 5, 'the workers were built');
    const loaded = {};
    for (const file of workers) {
        const missing = [];
        const code = fs.readFileSync(path.join(out, file), 'utf8')
            .replace(/const \{ ([^}]*) \} = __require\("([^"]+)"\);/g, (m, names, id) => `${m} __check({ ${names} }, ${JSON.stringify(id)});`);
        const context = vm.createContext({ ...globals, self: {}, __check: (taken, id) => { for (const [name, value] of Object.entries(taken)) if (value === undefined) missing.push(`${name} from ${id}`); } });
        vm.runInContext(code, context);
        assert.deepEqual(missing, [], `${file}: every imported name arrives`);
        loaded[file] = context.self;
    }
    // the two flat bundles (no module registry: they only have to load and offer their functions)
    const flat = vm.createContext({ ...globals, self: {} });
    vm.runInContext(fs.readFileSync(path.join(out, 'finalize.js'), 'utf8'), flat);
    for (const name of ['createStreamParser', 'finishDetached']) assert.equal(typeof flat.self.AISH_FINALIZE[name], 'function', 'finalize.js offers ' + name);
    for (const name of ['content.js', 'finalize.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(out, name), 'utf8')), name + ' is valid script');
    const { dataHooks } = loaded['sync-worker.js'].AISH_SYNC;
    const shown = dataHooks.compose('<p>Base</p>', [{ q: 'Why <now>?', a: 'Because.', pinned: true }]);
    assert.ok(shown.startsWith('<p>Base</p>') && shown.includes('Why &lt;now&gt;?'), 'a pulled article with a question gets its summary');

    // a name that is not there stops the build instead of someone's sync
    const src = path.join(here, '..', 'scripts', 'build.js');
    assert.ok(fs.readFileSync(src, 'utf8').includes('does not export'), 'the bundler checks the names');
} finally { fs.rmSync(out, { recursive: true, force: true }); }
console.log('test285 passed');
