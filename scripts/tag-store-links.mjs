// Store links on the website carry UTM parameters, so the store dashboards can tell which page brought a visit:
// the Chrome Web Store breaks listing views down by utm_source / utm_medium / utm_campaign, AMO breaks installs down
// by the same parameters. Runs over every built page in docs/ (English and translated), last step of `npm run site:build`.
//   utm_source=website · utm_medium=<page path, e.g. home, blog-pocket-alternative, de-bildung> · utm_campaign=<data-cta of the link, or "link">
// Idempotent: a link that already has utm_source is left alone. Structured data (JSON-LD) keeps the plain store URL.
//   node scripts/tag-store-links.mjs [--check]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const STORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org|microsoftedge\.microsoft\.com)\//;

/** utm_medium for a page: its path without index.html / .html, slashes as dashes; the home page is "home". */
export function mediumFor(rel) {
  const p = rel.replace(/\\/g, '/').replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '');
  return (p || 'home').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** The same URL with the UTM parameters added (unchanged when it is not a store link or already tagged). */
export function tagUrl(href, medium, campaign = 'link') {
  if (!STORE.test(href)) return href;
  let u;
  try { u = new URL(href.replace(/&amp;/g, '&')); } catch (_) { return href; }
  if (u.searchParams.has('utm_source')) return href;
  u.searchParams.set('utm_source', 'website');
  u.searchParams.set('utm_medium', medium);
  u.searchParams.set('utm_campaign', campaign);
  return u.toString().replace(/&/g, '&amp;');
}

// where on the page a link sits, from its class (first match wins); data-cta="…" on a link overrides it
const CAMPAIGN_BY_CLASS = [['mm-cta', 'menu'], ['pill-cta', 'nav'], ['tier-cta', 'pricing'], ['btn-primary', 'cta'], ['btn-secondary', 'cta'], ['footer-link', 'footer']];

/** Tag every <a href="store"> in a page. The campaign says where the link sits (nav, menu, cta, pricing, …). */
export function tagHtml(html, medium) {
  return html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref=("|')([^"']+)\1/i);
    if (!href || !STORE.test(href[2])) return tag;
    const cta = tag.match(/\bdata-cta=("|')([^"']*)\1/i);
    const cls = ((tag.match(/\bclass=("|')([^"']*)\1/i) || [])[2] || '').split(/\s+/);
    const byClass = CAMPAIGN_BY_CLASS.find(([c]) => cls.includes(c));
    const campaign = (cta && /^[a-z0-9_-]+$/i.test(cta[2].trim())) ? cta[2].trim() : byClass ? byClass[1] : 'link';
    return tag.replace(href[0], `href=${href[1]}${tagUrl(href[2], medium, campaign)}${href[1]}`);
  });
}

async function* pages(dir, rel = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'assets' || e.name === 'node_modules') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* pages(path.join(dir, e.name), r);
    else if (e.name.endsWith('.html')) yield r;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let changed = 0, links = 0;
  for await (const rel of pages(DOCS)) {
    const file = path.join(DOCS, rel);
    const html = await readFile(file, 'utf8');
    const next = tagHtml(html, mediumFor(rel));
    if (next !== html) {
      changed++;
      links += (next.match(/utm_source=website/g) || []).length - (html.match(/utm_source=website/g) || []).length;
      if (!check) await writeFile(file, next, 'utf8');
    }
  }
  if (check && changed) { console.error(`${changed} page(s) have store links without UTM parameters: run node scripts/tag-store-links.mjs`); process.exit(1); }
  console.log(check ? 'store links tagged' : `tagged ${links} store link(s) in ${changed} page(s)`);
}
