// White-label layer (brands/index.mjs): a brand is a delta applied to a finished build; the default brand is a no-op,
// translation lookup keys (T('…') literals, f_<slug>_<hash> message keys) survive, and no old brand name stays visible.
// Uses a synthetic brand so it runs whether or not a real brand file (brands/<id>.json) is present.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const brandsJs = path.join(SRC, '..', '..', 'brands', 'index.mjs');
if (!fs.existsSync(brandsJs)) { console.log('ok (no brands/ folder: plain default build)'); process.exit(0); }
const brands = await import(pathToFileURL(brandsJs).href);
const { keyOf } = await import(pathToFileURL(path.join(SRC, 'modules/feedI18n.js')).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-test-'));
const copy = (name) => { const d = path.join(tmp, name); fs.cpSync(SRC, d, { recursive: true }); return d; };
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
const fake = { id: 'testbrand', slug: 'testbrand', name: 'Zed', short: 'Zed', colors: { '#2563eb': '#123456' }, dir: tmp };

// 1. default brand: nothing changes, byte for byte
const a = copy('default');
const stats = brands.applyBrand(a, brands.loadBrand(brands.DEFAULT_BRAND), 'extension');
assert.deepStrictEqual(stats, { files: 0, text: 0, colors: 0, assets: 0 });
assert.strictEqual(read(a, '_locales/en/messages.json'), read(SRC, '_locales/en/messages.json'));

// 2. a brand: visible name and colours change
const b = copy('branded');
const s = brands.applyBrand(b, fake, 'extension');
assert.ok(s.files > 10 && s.text > 100, 'rewrote the name across the build');
const en = JSON.parse(read(b, '_locales/en/messages.json'));
assert.ok(en.extensionName.message.startsWith('Zed'), 'extension name');
assert.ok(!/AI Summary Helper/.test(read(b, 'popup.html')), 'popup.html carries no old name');
assert.ok(/--accent: #123456/.test(read(b, 'styles.css')) && !/--accent: #2563eb/i.test(read(b, 'styles.css')), 'accent colour');

// 3. translation lookup survives: same keys, and every T('…') literal in the code still resolves to a key present in en
const keysBefore = Object.keys(JSON.parse(read(a, '_locales/en/messages.json'))), keysAfter = Object.keys(en);
assert.deepStrictEqual(keysAfter, keysBefore, 'message keys are never rewritten');
const litRe = /\bT\(\s*'((?:[^'\\\n]|\\.)*)'/g;
const missing = (dir, msgs) => [...read(dir, 'modules/authManager.js').matchAll(litRe)].filter((m) => !msgs[keyOf(m[1].replace(/\\'/g, "'"))]).length;
assert.strictEqual(missing(b, en), missing(a, JSON.parse(read(a, '_locales/en/messages.json'))), 'no T() literal lost its translation');
assert.ok(/T\('Sign in to AI Summary Helper'\)/.test(read(b, 'modules/authManager.js')), 'T() literals are masked, not rewritten');

// 4. identifiers are left alone, and nothing but T() fallbacks still shows the old name
assert.ok(/__AISH_CONTENT_LOADED|AISH_FINALIZE|aish-hl-host/.test(read(b, 'content/highlighter.js') + read(b, 'background.js') + read(b, 'loader.js')), 'identifiers kept');
assert.deepStrictEqual(brands.leakReport(b, fake).leaks, [], 'no visible old brand outside translation keys');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok');
