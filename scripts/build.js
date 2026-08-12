#!/usr/bin/env node
/**
 * Multi-platform build & sync tool.
 *
 * `src/` is the single source of truth (Chrome MV3 WebExtension, Vanilla JS).
 * This script syncs `src/` into per-platform build targets and applies the
 * platform-specific manifest overrides:
 *
 *   - chrome  → dev/aish-extension-chrome   (uses src/manifest.json as-is)
 *   - firefox → dev/aish-extension-firefox  (uses platforms/firefox/manifest.json)
 *   - ios     → dev/aish-extension-ios      (uses platforms/ios/manifest.json)
 *
 * This is a lightweight dev-sync tool. For full releases (version bump +
 * zipping into prod/), use build_chrome_extension.sh instead.
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
    'manifest-android.json', // Android uses a separate manifest, not a platform dir
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
 * Copy the shared source into a platform build dir, then overlay the
 * platform-specific manifest (if provided).
 */
function buildPlatform(name, manifestPath) {
    const outDir = path.join(DEV, `aish-extension-${name}`);
    fs.rmSync(outDir, { recursive: true, force: true });
    copyDir(SRC, outDir);

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
        buildPlatform('chrome', null);
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
