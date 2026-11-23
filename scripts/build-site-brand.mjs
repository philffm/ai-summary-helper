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

const args = process.argv.slice(2);
const brand = loadBrand(brandIdFromArgs(args));
if (isDefault(brand)) { console.error('Pick a brand: node scripts/build-site-brand.mjs --<brand>'); process.exit(1); }

const src = path.join(REPO, 'docs');
const out = path.join(REPO, `docs-${brand.slug}`);
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
warnProvisional(brand);
brandBuild(out, brand, 'site', { strict: args.includes('--strict') });
console.log(`✅ ${brand.name} site written to ${path.relative(REPO, out)}/`);
