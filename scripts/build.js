#!/usr/bin/env node
/**
 * Multi-platform build & sync tool.
 *
 * `src/` is the single source of truth (Chrome MV3 WebExtension, Vanilla JS).
 * This script syncs `src/` into per-platform build targets and applies the
 * platform-specific manifest overrides:
 *
 *   - chrome  → dev/aish-extension-chrome   (uses platforms/chrome/manifest.json)
 *   - android → dev/aish-extension-android  (uses platforms/android/manifest.json)
 *   - firefox → dev/aish-extension-firefox  (uses platforms/firefox/manifest.json)
 *   - ios     → dev/aish-extension-ios      (uses platforms/ios/manifest.json)
 *
 * This is a lightweight dev-sync tool. For full releases (version bump +
 * zipping into prod/), use build.sh instead.
 *
 * Usage:
 *   node scripts/build.js            # build all platforms
 *   node scripts/build.js chrome     # build only chrome
 *   node scripts/build.js firefox    # build only firefox
 *   node scripts/build.js ios        # build only ios
 *   node scripts/build.js --clean    # wipe dev/ before building
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
function bundleContentScript(entryPath) {
    const seen = new Set(); // absolute paths already inlined
    const parts = [];

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
    return parts.join('\n\n');
}

/**
 * Copy the shared source into a platform build dir, then overlay the
 * platform-specific manifest (if provided).
 */
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

function main() {
    const args = process.argv.slice(2);
    const clean = args.includes('--clean');
    const targets = args.filter(a => !a.startsWith('--'));

    if (clean) {
        fs.rmSync(DEV, { recursive: true, force: true });
        console.log('🧹 Cleaned dev/');
    }

    const all = targets.length === 0;
    const requested = (name) => all || targets.includes(name);

    console.log('🔨 Building extension targets…');

    if (requested('chrome')) {
        buildPlatform('chrome', path.join(PLATFORMS, 'chrome', 'manifest.json'));
    }
    if (requested('android')) {
        buildPlatform('android', path.join(PLATFORMS, 'android', 'manifest.json'));
    }
    if (requested('firefox')) {
        buildPlatform('firefox', path.join(PLATFORMS, 'firefox', 'manifest.json'));
    }
    if (requested('ios')) {
        buildPlatform('ios', path.join(PLATFORMS, 'ios', 'manifest.json'));
    }

    console.log('✅ Build complete.');
}

main();
