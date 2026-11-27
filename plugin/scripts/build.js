#!/usr/bin/env node
/**
 * Multi-platform build & sync tool.
 *
 * `plugin/src/` is the single source of truth (Chrome MV3 WebExtension,
 * Vanilla JS). This script syncs `plugin/src/` into per-platform build
 * targets and applies the platform-specific manifest overrides:
 *
 *   - chrome  → plugin/dev/aish-extension-chrome   (uses plugin/platforms/chrome/manifest.json)
 *   - android → plugin/dev/aish-extension-android  (uses plugin/platforms/android/manifest.json)
 *   - firefox → plugin/dev/aish-extension-firefox  (uses plugin/platforms/firefox/manifest.json)
 *   - ios     → plugin/dev/aish-extension-ios      (uses plugin/platforms/ios/manifest.json)
 *
 * This is a lightweight dev-sync tool. For full releases (version bump +
 * zipping into plugin/prod/), use plugin/build.sh instead.
 *
 * Usage:
 *   node plugin/scripts/build.js            # build all platforms
 *   node plugin/scripts/build.js chrome     # build only chrome
 *   node plugin/scripts/build.js firefox    # build only firefox
 *   node plugin/scripts/build.js ios        # build only ios
 *   node plugin/scripts/build.js --clean    # wipe dev/ before building
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { slimLocales } = await import('./slim-locales.mjs');
// This script lives in plugin/scripts/, so ROOT resolves to plugin/.
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DEV = path.join(ROOT, 'dev');
const PLATFORMS = path.join(ROOT, 'platforms');

// Files that are never copied into a platform build.
const EXCLUDED = new Set([
    'node_modules',
    '.DS_Store',
]);

/**
 * Recursively copy a directory, skipping excluded entries.
 */
function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (EXCLUDED.has(entry.name)) continue;
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Custom mini-bundler for the content script.
 *
 * MV3 content scripts can't use ES modules directly, so we inline the
 * `src/content/*.js` modules into a single self-contained `content.js`.
 * The modules are plain ES modules with no external deps, so a simple
 * concat-based bundler works:
 *   - Resolve `import ... from './content/X.js'` statements
 *   - Inline each module body (stripping `import`/`export` keywords)
 *   - Handle nested imports (module A importing from module B)
 *   - Emit one bundled file
 *
 * @param {string} entryPath absolute path to src/content.js
 * @returns {string} bundled JS source
 */
function bundleContentScript(entryPath, opts = {}) {
    const seen = new Set(); // absolute paths already inlined
    const parts = [];

    // Guard-detection: if the entry file is already a bundled output (it
    // contains the injection-guard marker we emit below), then src/content.js
    // has been accidentally overwritten with a previously-bundled copy of
    // itself. Bundling it again would wrap it in a SECOND injection guard,
    // silently no-opping the entire content script at runtime. Fail loudly
    // here instead of shipping a broken build.
    const entrySrc = fs.readFileSync(entryPath, 'utf8');
    if (entrySrc.includes('__AISH_CONTENT_LOADED')) {
        throw new Error(
            `Refusing to bundle ${entryPath}: it already contains the injection-guard ` +
            `marker (__AISH_CONTENT_LOADED). This means src/content.js was overwritten ` +
            `with an already-bundled copy of itself. Restore the modular source ` +
            `(git checkout -- ${entryPath}) and re-run the build.`
        );
    }

    function stripModuleSyntax(src) {
        // Remove `import ... from '...';` and `export ` keywords.
        return src
            .replace(/^import\s+[^;]+;\s*$/gm, '')
            .replace(/^export\s+/gm, '');
    }

    function resolveModule(absPath) {
        if (seen.has(absPath)) return;
        seen.add(absPath);

        const src = fs.readFileSync(absPath, 'utf8');
        // Find relative imports: import { ... } from './content/X.js';
        const importRe = /import\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]\s*;/g;
        let m;
        const imports = [];
        while ((m = importRe.exec(src)) !== null) {
            imports.push(m[1]);
        }

        // Inline dependencies first (depth-first), then this module.
        for (const spec of imports) {
            const depPath = path.resolve(path.dirname(absPath), spec);
            resolveModule(depPath);
        }

        parts.push(stripModuleSyntax(src));
    }

    resolveModule(entryPath);
    const body = parts.join('\n\n');

    // Wrap the ENTIRE bundle in an injection guard. Safari on iOS (and some
    // SPA navigations) re-injects content scripts, which would otherwise
    // redeclare top-level `let`/`const` from the inlined modules (e.g.
    // `annotationUrlWatcher`) and throw a SyntaxError. The `window` object
    // persists between these phantom re-injections, so the flag guarantees
    // the bundle body (and all its top-level declarations) runs only once.
    if (opts.expose) {
        // Classic-script bundle for the background worker: private scope, one global.
        return `// AI Summary Helper — bundled ${opts.expose.global} (background)
(function () {
${body}

self.${opts.expose.global} = { ${opts.expose.names.join(', ')} };
})();
`;
    }
    return `// AI Summary Helper — bundled content script (injection-guarded)
if (!window.__AISH_CONTENT_LOADED) {
    window.__AISH_CONTENT_LOADED = true;

${body}

}
`;
}

function bundleModuleGraph(entryPath, globalName) {
    const modules = new Map();
    const idOf = (file) => path.relative(SRC, file).replace(/\\/g, '/');
    function resolve(absPath) {
        const id = idOf(absPath);
        if (modules.has(id)) return;
        let src = fs.readFileSync(absPath, 'utf8');
        const deps = [];
        const reExports = [];   // [name outside, expression inside]
        const pairs = (list) => list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/));
        // `export { a, b as c } from './x.js';` — taken from the other module, offered by this one
        let hop = 0;
        src = src.replace(/^export\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;?[ \t]*(?:\/\/.*)?$/gm, (all, list, spec) => {
            const local = `__re${hop++}`;
            for (const [name, as] of pairs(list)) reExports.push([as || name, `${local}.${name}`]);
            return `import { __all as ${local} } from '${spec}';`;
        });
        // `export { a, b as c };` — names this module has already
        src = src.replace(/^export\s+\{([^}]*)\}\s*;?[ \t]*(?:\/\/.*)?$/gm, (all, list) => {
            for (const [name, as] of pairs(list)) reExports.push([as || name, name]);
            return '';
        });
        const unknown = src.match(/^export\s+(?!(?:async\s+)?(?:function|const|let|class)\s+\w)[^\n]*/m);
        if (unknown) throw new Error(`${id}: the bundler does not understand "${unknown[0]}"`);
        const importRe = /^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm;
        let match;
        while ((match = importRe.exec(src))) {
            const wanted = pairs(match[1]);
            const dep = path.resolve(path.dirname(absPath), match[2]);
            resolve(dep);
            const from = JSON.stringify(idOf(dep));
            if (wanted[0] && wanted[0][0] === '__all') {
                deps.push({ start: match.index, end: importRe.lastIndex, code: `const ${wanted[0][1]} = __require(${from});` });
                continue;
            }
            // a name the other module does not offer would only show up as "x is not a function" in someone's browser
            const offered = modules.get(idOf(dep));
            for (const [name] of offered ? wanted : []) {
                if (!offered.exports.includes(name)) throw new Error(`${id}: ${idOf(dep)} does not export "${name}"`);
            }
            const names = wanted.map(([imported, local]) => `${imported}${local ? `: ${local}` : ''}`).join(', ');
            deps.push({ start: match.index, end: importRe.lastIndex, code: `const { ${names} } = __require(${from});` });
        }
        for (const dep of deps.reverse()) src = src.slice(0, dep.start) + dep.code + src.slice(dep.end);
        const exports = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
        src = src.replace(/^export\s+/gm, '');
        modules.set(id, { src, exports: [...exports, ...reExports.map(([name]) => name)],
            returns: [...exports, ...reExports.map(([name, value]) => (name === value ? name : `${name}: ${value}`))] });
    }
    resolve(entryPath);
    const factories = [...modules].map(([id, module]) =>
        `${JSON.stringify(id)}: (__require) => { ${module.src}\nreturn { ${module.returns.join(', ')} }; }`
    ).join(',\n');
    const entryId = idOf(entryPath);
    return `// AI Summary Helper — bundled background modules
(function () {
    const __factories = { ${factories} };
    const __cache = {};
    function __require(id) {
        if (__cache[id]) return __cache[id];
        const out = __cache[id] = {};
        Object.assign(out, __factories[id](__require));
        return out;
    }
    self.${globalName} = __require(${JSON.stringify(entryId)}).API;
})();
`;
}

/** finalize.js: the "after the model finished" logic as a classic script, so the background worker can finish a run whose page went away. */
function writeFinalize(outDir, name) {
    const entry = path.join(SRC, 'content', 'finalize.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleContentScript(entry, { expose: { global: 'AISH_FINALIZE', names: ['createStreamParser', 'finishDetached'] } });
    fs.writeFileSync(path.join(outDir, 'finalize.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled finalize.js (${code.length} bytes)`);
}

function writeInboxWorker(outDir, name) {
    const entry = path.join(SRC, 'modules', 'inboxBackgroundBundle.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleModuleGraph(entry, 'AISH_INBOX');
    fs.writeFileSync(path.join(outDir, 'inbox-worker.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled inbox-worker.js (${code.length} bytes)`);
}

function writeTargetsWorker(outDir, name) {
    const entry = path.join(SRC, 'modules', 'targetsBackgroundBundle.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleModuleGraph(entry, 'AISH_TARGETS');
    fs.writeFileSync(path.join(outDir, 'targets-worker.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled targets-worker.js (${code.length} bytes)`);
}

function writeFeedWorker(outDir, name) {
    const entry = path.join(SRC, 'modules', 'feedBackgroundBundle.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleModuleGraph(entry, 'AISH_FEED_WORKER');
    fs.writeFileSync(path.join(outDir, 'feed-worker.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled feed-worker.js (${code.length} bytes)`);
}

function writeMcpWorker(outDir, name) {
    const entry = path.join(SRC, 'modules', 'mcpBackgroundBundle.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleModuleGraph(entry, 'AISH_MCP');
    fs.writeFileSync(path.join(outDir, 'mcp-worker.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled mcp-worker.js (${code.length} bytes)`);
}

/**
 * Copy the shared source into a platform build dir, then overlay the
 * platform-specific manifest (if provided).
 */
function writeSyncWorker(outDir, name) {
    const entry = path.join(SRC, 'modules', 'syncBackgroundBundle.js');
    if (!fs.existsSync(entry)) return;
    const code = bundleModuleGraph(entry, 'AISH_SYNC');
    fs.writeFileSync(path.join(outDir, 'sync-worker.js'), code);
    console.log(`  ✓ ${name || 'bundle'}: bundled sync-worker.js (${code.length} bytes)`);
}

function buildPlatform(name, manifestPath) {
    const outDir = path.join(DEV, `aish-extension-${name}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    copyDir(SRC, outDir);

    // Bundle the modular content script into a single file for this platform.
    const entry = path.join(SRC, 'content.js');
    if (fs.existsSync(entry)) {
        const bundled = bundleContentScript(entry);
        fs.writeFileSync(path.join(outDir, 'content.js'), bundled);
        console.log(`  ✓ ${name}: bundled content.js (${bundled.length} bytes)`);
    }

    writeFinalize(outDir, name);
    writeFeedWorker(outDir, name);
    writeInboxWorker(outDir, name);
    writeTargetsWorker(outDir, name);
    writeMcpWorker(outDir, name);
    writeSyncWorker(outDir, name);
    const loc = slimLocales(outDir);
    console.log(`  ✓ ${name}: _locales ${Math.round(loc.before / 1024)} KB → ${Math.round(loc.after / 1024)} KB (${loc.dropped} unused keys, notes only in en)`);

    if (manifestPath && fs.existsSync(manifestPath)) {
        fs.copyFileSync(manifestPath, path.join(outDir, 'manifest.json'));
        console.log(`  ✓ ${name}: applied manifest ${path.relative(ROOT, manifestPath)}`);
    } else {
        // Default: keep src/manifest.json (Chrome)
        console.log(`  ✓ ${name}: using src/manifest.json`);
    }
    console.log(`  ✓ ${name}: synced ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, outDir)}`);
    return outDir;
}

async function main() {
    const args = process.argv.slice(2);
    // One module graph as a classic script that sets self.<global> to the entry's `API`, written where asked. The iOS app
    // bundles the sync modules this way (mobile/ios/js/appSync.js). Usage: --module-bundle <entry> <global> <out file>
    const graphIdx = args.indexOf('--module-bundle');
    if (graphIdx !== -1) {
        const [entry, global, out] = args.slice(graphIdx + 1, graphIdx + 4);
        if (!entry || !global || !out) {
            console.error('Usage: node scripts/build.js --module-bundle <entry> <global> <out file>');
            process.exit(1);
        }
        try {
            const code = bundleModuleGraph(path.resolve(entry), global);
            fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
            fs.writeFileSync(path.resolve(out), code);
            console.log(`  ✓ bundled ${path.basename(out)} (${code.length} bytes)`);
        } catch (err) {
            console.error(`✗ ${err.message}`);
            process.exit(1);
        }
        return;
    }

    // Design tokens must be up to date and WCAG AA in every brand × theme (and every stylesheet colour pair, see design-system/build.mjs): a build with an unreadable pair does not ship.
    execFileSync(process.execPath, [path.join(ROOT, '..', 'design-system', 'build.mjs'), '--check'], { stdio: 'inherit' });
    const clean = args.includes('--clean');
    const apiBase = parseApiFlag(args);
    const stripeTest = args.includes('--stripe-test');
    const targets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--api');

    // Standalone bundling mode, used by plugin/build.sh. Collapses the
    // content-script bundler into this single implementation (build.sh no
    // longer carries its own inline copy). Usage: --bundle <target_dir>
    const bundleIdx = args.indexOf('--bundle');
    if (bundleIdx !== -1) {
        const targetDir = args[bundleIdx + 1];
        if (!targetDir) {
            console.error('Usage: node scripts/build.js --bundle <target_dir>');
            process.exit(1);
        }
        const entry = path.join(SRC, 'content.js');
        if (!fs.existsSync(entry)) {
            console.error(`No ${path.relative(ROOT, entry)} found to bundle.`);
            process.exit(1);
        }
        try {
            const bundled = bundleContentScript(entry);
            fs.writeFileSync(path.join(targetDir, 'content.js'), bundled);
            console.log(`  ✓ bundled content.js (${bundled.length} bytes)`);
            writeFinalize(targetDir);
            writeFeedWorker(targetDir);
            writeInboxWorker(targetDir);
            writeTargetsWorker(targetDir);
            writeMcpWorker(targetDir);
            writeSyncWorker(targetDir);
            const loc = slimLocales(targetDir);
            console.log(`  ✓ _locales ${Math.round(loc.before / 1024)} KB → ${Math.round(loc.after / 1024)} KB (${loc.dropped} unused keys)`);
        } catch (err) {
            console.error(`✗ ${err.message}`);
            process.exit(1);
        }
        return;
    }

    if (clean) {
        fs.rmSync(DEV, { recursive: true, force: true });
        console.log('🧹 Cleaned dev/');
    }

    const all = targets.length === 0;
    const requested = (name) => all || targets.includes(name);

    const built = [];
    console.log('🔨 Building extension targets…');

    if (requested('chrome')) {
        built.push(buildPlatform('chrome', path.join(PLATFORMS, 'chrome', 'manifest.json')));
    }
    if (requested('android')) {
        built.push(buildPlatform('android', path.join(PLATFORMS, 'android', 'manifest.json')));
    }
    if (requested('firefox')) {
        built.push(buildPlatform('firefox', path.join(PLATFORMS, 'firefox', 'manifest.json')));
    }
    if (requested('ios')) {
        built.push(buildPlatform('ios', path.join(PLATFORMS, 'ios', 'manifest.json')));
    }

    // the App Store build shows nothing to buy (modules/storeBuild.js)
    for (const dir of built.filter((d) => d && /-ios$/.test(d))) { useStoreBuild(dir); useIosDescriptions(dir); }
    if (stripeTest) for (const dir of built.filter(Boolean)) useStripeTestMode(dir);
    if (apiBase) for (const dir of built.filter(Boolean)) pointAtApi(dir, apiBase);
    // The source stylesheets are written in Kaivo colours (design-system/config.json), the source text in AISH: the plain build is the
    // AISH build, so its token regions go back to the AISH blue. `--kaivo` (below) copies this build and writes the Kaivo regions.
    for (const dir of built.filter(Boolean)) execFileSync(process.execPath, [path.join(ROOT, '..', 'design-system', 'build.mjs'), '--brand=aish', '--into', dir, '--context', 'app'], { stdio: 'inherit' });
    await brandCopies(built.filter(Boolean), args);
    console.log('✅ Build complete.');
}

function copyTree(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const a = path.join(from, e.name), b = path.join(to, e.name);
        if (e.isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
    }
}

/**
 * The source-brand build in dev/aish-extension-<platform> stays as it is, and a rebranded copy goes to
 * dev/<slug>-extension-<platform>: Kaivo unless `--<brand>` / `--brand=<id>` names another (`--aish`: no copy; see
 * brands/README.md). `--strict` fails when the old name is still visible.
 * Without brands/ in the checkout (it is git-excluded) the flag is ignored with a warning.
 */
async function brandCopies(dirs, args) {
    const BRANDS = path.join(ROOT, '..', 'brands', 'index.mjs');
    if (!fs.existsSync(BRANDS)) { console.warn('  ! brand flag ignored: brands/index.mjs is not in this checkout'); return; }
    const { brandIdFromArgs, loadBrand, isDefault, brandBuild, warnProvisional } = await import(pathToFileURL(BRANDS).href);
    const brand = loadBrand(brandIdFromArgs(args));
    if (isDefault(brand)) return;
    warnProvisional(brand);
    for (const dir of dirs) {
        const platform = path.basename(dir).replace(/^aish-extension-/, '');
        const out = path.join(DEV, `${brand.slug || brand.id}-extension-${platform}`);
        fs.rmSync(out, { recursive: true, force: true });
        copyTree(dir, out);
        brandBuild(out, brand, 'extension', { platform, strict: args.includes('--strict') });
        console.log(`  ✓ ${brand.name}: ${path.relative(ROOT, out)}`);
    }
}

/**
 * Dev builds only: --api http://localhost:3000 points every call to https://api.byphil.eu in the built files at another
 * server (a local byphilapi with Stripe test keys, a staging copy). Never used by the release workflow.
 */
const PROD_API = 'https://api.byphil.eu';
function parseApiFlag(args) {
    const i = args.indexOf('--api');
    if (i === -1) return null;
    const raw = String(args[i + 1] || '').replace(/\/+$/, '');
    let u;
    try { u = new URL(raw); } catch (_) { u = null; }
    const local = u && u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (!u || !(local || u.protocol === 'https:') || u.pathname !== '/' || u.search || u.hash) {
        console.error('Usage: node scripts/build.js <targets> --api http://localhost:3000   (http only for localhost, no path)');
        process.exit(1);
    }
    return u.origin;
}
function pointAtApi(dir, base) {
    let files = 0, hits = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== 'lib' && e.name !== '_locales') walk(p); continue; }
            if (!/\.(m?js|html|json)$/.test(e.name)) continue;
            const src = fs.readFileSync(p, 'utf8');
            if (!src.includes(PROD_API)) continue;
            const n = src.split(PROD_API).length - 1;
            fs.writeFileSync(p, src.split(PROD_API).join(base));
            files += 1; hits += n;
        }
    };
    walk(dir);
    console.log(`  ⚠ ${path.basename(dir)}: DEV BUILD, API → ${base} (${hits} references in ${files} files). Do not ship this build.`);
}

/** Apple refuses an upload when a language's extension description is longer than 112 characters (the browser stores
 *  allow 132): the iOS build takes the shorter ones from ios-descriptions.json, and stops if one is still too long. */
function useIosDescriptions(dir) {
    const short = JSON.parse(fs.readFileSync(path.join(__dirname, 'ios-descriptions.json'), 'utf8'));
    const root = path.join(dir, '_locales');
    for (const locale of fs.readdirSync(root)) {
        const file = path.join(root, locale, 'messages.json');
        if (!fs.existsSync(file)) continue;
        const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entry = messages.extensionDescription;
        if (!entry) continue;
        if (short[locale]) { entry.message = short[locale]; fs.writeFileSync(file, JSON.stringify(messages, null, 2) + '\n'); }
        if (entry.message.length > 112) { console.error(`  ✗ ${path.basename(dir)}: the ${locale} extension description has ${entry.message.length} characters, Apple allows 112`); process.exit(1); }
    }
}

/** Sets every `/*@store-build*\/ false` of a build to true; a build without one would show purchases, so that stops here. */
function useStoreBuild(dir) {
    const MARK = '/*@store-build*/ false';
    let hits = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!p.endsWith('.js')) continue;
            const src = fs.readFileSync(p, 'utf8');
            if (src.includes(MARK)) { fs.writeFileSync(p, src.split(MARK).join('true')); hits++; }
        }
    };
    walk(dir);
    // the module, the classic background script and the bundled content script
    if (hits < 3) { console.error(`  ✗ ${path.basename(dir)}: the store-build mark was found ${hits} times, expected at least 3`); process.exit(1); }
    console.log(`  ✓ ${path.basename(dir)}: no purchases (${hits} files)`);
}

/**
 * Dev builds only: --stripe-test makes “Get the Support Pass” ask the API for Stripe's TEST checkout (&mode=test).
 * Production byphilapi sends testers (BILLING_TESTERS) to the test links and refuses everyone else, so you can buy with
 * card 4242 4242 4242 4242 against the real API. Never used by the release workflow.
 */
const CHECKOUT = `'${PROD_API}/v1/billing/checkout'`;
function useStripeTestMode(dir) {
    let hits = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (e.name !== 'lib' && e.name !== '_locales') walk(p); continue; }
            if (!/\.m?js$/.test(e.name)) continue;
            const src = fs.readFileSync(p, 'utf8');
            if (!src.includes(CHECKOUT)) continue;
            hits += src.split(CHECKOUT).length - 1;
            fs.writeFileSync(p, src.split(CHECKOUT).join(`'${PROD_API}/v1/billing/checkout?mode=test'`));
        }
    };
    walk(dir);
    if (!hits) { console.error(`  ✗ ${path.basename(dir)}: --stripe-test found no checkout link to switch`); process.exit(1); }
    console.log(`  ⚠ ${path.basename(dir)}: DEV BUILD, Stripe TEST checkout (${hits}). Do not ship this build.`);
}

await main();
