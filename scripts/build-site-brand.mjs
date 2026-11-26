#!/usr/bin/env node
// scripts/build-site-brand.mjs: a white-labelled copy of the finished site.
//
// Takes docs/ (the generated, translated site that `npm run site:build` / translate.mjs produce) and writes
// docs-<brand>/ with the brand applied: name, colours, icon, canonical/hreflang/sitemap host, CNAME. docs/ itself
// is never touched, so the default site keeps deploying exactly as before.
//
//   npm run site:build && npm run site:brand -- --<brand>
//   node scripts/build-site-brand.mjs --<brand> [--strict]
import fs from 'node:fs';
import path from 'node:path';
import { loadBrand, brandIdFromArgs, brandBuild, warnProvisional, isDefault, REPO } from '../brands/index.mjs';

// The brand's own pictures: brands/<id>/site/<path under assets/> replaces assets/<path> (names stay, pages need no change).
function overlayArtwork(out, from) {
  if (!fs.existsSync(from)) return;
  const files = fs.readdirSync(from, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => !f.startsWith('i18n/') && /\.(webp|png|jpg)$/.test(f));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(out, 'assets', f)), { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(out, 'assets', f)); }
  console.log(`  ✓ brand artwork: ${files.length} pictures`);
}

// Artwork with text in it exists per language: brands/<id>/site/i18n/<lang>/<path under assets/> replaces assets/<path> on
// that language's pages (images, social preview tags and structured data alike).
function localizeArtwork(out, from) {
  if (!fs.existsSync(from)) return;
  let pictures = 0, pages = 0;
  for (const lang of fs.readdirSync(from).filter((l) => fs.existsSync(path.join(out, l)))) {
    const files = fs.readdirSync(path.join(from, lang), { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => /\.(webp|png|jpg)$/.test(f));
    fs.cpSync(path.join(from, lang), path.join(out, 'assets', 'i18n', lang), { recursive: true });
    pictures += files.length;
    for (const page of fs.readdirSync(path.join(out, lang), { recursive: true }).filter((f) => f.endsWith('.html'))) {
      const file = path.join(out, lang, page), html = fs.readFileSync(file, 'utf8');
      const next = files.reduce((s, f) => s.replaceAll(`assets/${f}`, `assets/i18n/${lang}/${f}`), html);
      if (next !== html) { fs.writeFileSync(file, next); pages++; }
    }
  }
  console.log(`  ✓ localized artwork: ${pictures} pictures on ${pages} pages`);
}

const args = process.argv.slice(2);
const brand = loadBrand(brandIdFromArgs(args));
if (isDefault(brand)) { console.log('docs/ is already the source brand: nothing to copy.'); process.exit(0); }

const src = path.join(REPO, 'docs');
const out = path.join(REPO, `docs-${brand.slug}`);
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
warnProvisional(brand);
brandBuild(out, brand, 'site', { strict: args.includes('--strict') });
overlayArtwork(out, path.join(brand.dir, 'site'));
localizeArtwork(out, path.join(brand.dir, 'site', 'i18n'));
console.log(`✅ ${brand.name} site written to ${path.relative(REPO, out)}/`);
