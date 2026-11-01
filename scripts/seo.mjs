#!/usr/bin/env node
// scripts/seo.mjs — idempotent SEO pass over docs/*.html (incl. the locale folders docs/<code>/):
//  * adds <link rel="canonical"> + og:url (self-referencing, clean URLs: index.html -> /)
//  * normalises hreflang hrefs to the same clean form
//  * drops hreflang alternates whose target page does not exist (not every post is translated)
//  * fills og:/twitter: tags (locale, site name, image) and adds JSON-LD (WebSite, SoftwareApplication, FAQPage, BlogPosting)
//  * videos (<figure data-blog-video>, files in docs/assets/blog/video/ + manifest.json from videos/scripts/video-manifest.mjs): VideoObject JSON-LD,
//    <track> subtitles, a transcript on the video cards, and docs/sitemap-video.xml
//  * regenerates docs/sitemap.xml (with hreflang alternates), docs/robots.txt and docs/llms.txt
// Runs at the end of `site:build` and `translate`.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE = 'https://ai-summary-helper.byphil.eu';
// Locale folders (docs/de/, docs/fr/ …) come from the translation config, so renaming them needs no change here.
const LOCALE_DIRS = Object.values(JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'i18n', 'locales.json'), 'utf8')).locales).map((l) => l.dir);
const isLocalized = (rel) => LOCALE_DIRS.some((d) => rel === d || rel.startsWith(d + '/'));
const DOCS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'docs');
const clean = (rel) => BASE + '/' + rel.replace(/(^|\/)index\.html$/, '$1');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === 'assets' || e.name === 'i18n' ? [] : walk(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}
const toUrl = (href) => {
  if (!href.startsWith(BASE + '/')) return href;
  return clean(href.slice(BASE.length + 1));
};


const STORE = 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb';
const OG_LOCALE = { en: 'en_US', de: 'de_DE', fr: 'fr_FR', es: 'es_ES', 'zh-Hans': 'zh_CN', 'zh-Hant': 'zh_TW', ja: 'ja_JP', ko: 'ko_KR', 'pt-BR': 'pt_BR', hi: 'hi_IN', vi: 'vi_VN' };
const DEFAULT_OG_IMAGE = BASE + '/assets/shots/aish-hero-en.webp';
const targetExists = (href) => {
  if (!href.startsWith(BASE + '/')) return true;
  let r = href.slice(BASE.length + 1);
  if (!r || r.endsWith('/')) r += 'index.html';
  return fs.existsSync(path.join(DOCS, r));
};
// Last change from git (stable across checkouts); file mtime is the deploy time on CI, which makes every page look new daily.
const lastmod = (file) => {
  try { const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: path.dirname(DOCS), encoding: 'utf8' }).trim(); if (d) return d; } catch (_) { /* no git */ }
  return null;
};
const setMeta = ($, attr, key, content) => { if (content && !$(`meta[${attr}="${key}"]`).length) $('head').append(`<meta ${attr}="${key}" content="${String(content).replace(/"/g, '&quot;')}">`); };
// English and German month names ("October 2026", "Oktober 2026"): the date of a post, for BlogPosting datePublished.
const MONTHS = ['january|januar', 'february|februar', 'march|märz|maerz', 'april', 'may|mai', 'june|juni', 'july|juli', 'august', 'september', 'october|oktober', 'november', 'december|dezember'];
const monthIso = (txt) => { const m = String(txt || '').match(new RegExp('(' + MONTHS.join('|') + ')\\s+(\\d{4})', 'i')); if (!m) return null; const n = MONTHS.findIndex((alts) => alts.split('|').includes(m[1].toLowerCase())); return n < 0 ? null : m[2] + '-' + String(n + 1).padStart(2, '0'); };
// ── videos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const VIDEO_DIR = path.join(DOCS, 'assets', 'blog', 'video');
// Google wants a full ISO 8601 datetime with a time zone for uploadDate / publication_date ("2026-10-20" alone is flagged).
const isoDateTime = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${d}T00:00:00+00:00` : d);
const VIDEO_MANIFEST = fs.existsSync(path.join(VIDEO_DIR, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, 'manifest.json'), 'utf8')) : {};
const TRANSCRIPT_LABEL = { en: 'Transcript', de: 'Transkript', es: 'Transcripción', fr: 'Transcription', pt: 'Transcrição', nl: 'Transcriptie', sv: 'Utskrift', ja: '文字起こし', ko: '스크립트' };
const isoDuration = (sec) => { const s = Math.round(sec); return `PT${Math.floor(s / 60)}M${s % 60}S`; };
const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };
const videoEntries = [];   // { self, videos: [{ title, description, thumb, content, duration, date, english }] } for sitemap-video.xml

/** VideoObject JSON-LD, <track> subtitles and (on the video cards) a transcript for every <figure data-blog-video> of a page. */
function videoPass($, file, self, lang) {
  $('[data-seo-video]').remove();
  const abs = (rel) => BASE + '/' + path.relative(DOCS, path.resolve(path.dirname(file), rel)).split(path.sep).join('/');
  const objects = [], seen = new Set(), listed = [];
  $('figure[data-blog-video]').each((_, fig) => {
    const $fig = $(fig), $src = $fig.find('video source').first();
    const srcRel = $src.attr('src') || '';
    const key = path.basename(srcRel).replace(/\.mp4$/, '');
    const entry = VIDEO_MANIFEST[key];
    if (!entry) return;
    const lc = (key.match(/^.+?-([a-z]{2}(?:-[a-z]+)?)$/) || [, 'en'])[1];
    // subtitles
    if (entry.vtt && !$fig.find('video track').length) {
      let label = lc; try { label = new Intl.DisplayNames([lc], { type: 'language' }).of(lc) || lc; } catch (_) { /* keep the code */ }
      $fig.find('video').first().append(`<track data-seo-video kind="captions" src="${srcRel.replace(/\.mp4$/, '.vtt')}" srclang="${lc}" label="${esc(label)}">`);
    }
    // name and description: from the page itself (translated with it), like the player does
    const card = $fig.closest('.feature-card');
    const name = clip($fig.find('figcaption strong, figcaption h3').first().text() || card.find('h3').first().text() || ($fig.find('.vstack-open').attr('aria-label') || '').replace(/^[^:]*:\s*/, ''), 100);
    const description = clip($fig.find('figcaption span, figcaption p').first().text() || card.find('p').first().text() || name, 300);
    // transcript on the video cards (the page of all videos)
    if (entry.transcript && $fig.hasClass('video-card') && !$fig.find('.vtranscript').length) {
      $fig.find('figcaption').first().append(`<details data-seo-video class="vtranscript"><summary>${esc(TRANSCRIPT_LABEL[lc] || TRANSCRIPT_LABEL.en)}</summary><p>${esc(entry.transcript)}</p></details>`);
    }
    // visible text next to the poster card (posts and landing pages): the transcript as short lines, so the clip stands out
    // and the page still carries its content as plain text (title and caption come from the page, the transcript from the manifest)
    if (entry.transcript && $fig.hasClass('post-video') && !$fig.hasClass('video-card') && !$fig.find('.vtext').length) {
      const t = String(entry.transcript).trim();
      const parts = (/[。！？]/.test(t) ? t.split(/(?<=[。！？])/) : t.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter(Boolean);
      const secs = Math.round(entry.duration || 0), dur = secs ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
      $fig.find('.post-video-in').first().append(`<div data-seo-video class="vtext"><p class="vtext-h">${esc(TRANSCRIPT_LABEL[lc] || TRANSCRIPT_LABEL.en)}${dur}</p><ul>${parts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
    }
    if (seen.has(key) || !name) return;
    seen.add(key);
    const thumb = abs(($fig.find('video').attr('poster') || '').trim() || srcRel.replace(/\.mp4$/, '.jpg'));
    const content = abs(srcRel);
    objects.push({
      '@type': 'VideoObject', name, description, thumbnailUrl: [thumb], uploadDate: isoDateTime(entry.uploaded), duration: isoDuration(entry.duration),
      contentUrl: content, inLanguage: lc, ...(entry.transcript ? { transcript: entry.transcript } : {}), isFamilyFriendly: true,
      publisher: { '@id': 'https://byphil.eu/#org' },
    });
    listed.push({ title: name, description, thumb, content, duration: Math.round(entry.duration), date: isoDateTime(entry.uploaded),
      english: lc === 'en' && !/^en\b/i.test(lang) });   // a translated page still showing the English original (no recording in its language yet)
  });
  if (!objects.length) return;
  $('head').append(`<script type="application/ld+json" data-seo-video>${JSON.stringify({ '@context': 'https://schema.org', '@graph': objects })}</script>`);
  videoEntries.push({ self, videos: listed });
}

function jsonLd($, rel, self, lang, title, desc, image) {
  $('script[data-seo="ld"]').remove();
  const graph = [];
  const publisher = { '@type': 'Organization', '@id': 'https://byphil.eu/#org', name: 'byphil', url: 'https://byphil.eu/' };
  const isHome = rel === 'index.html' || LOCALE_DIRS.some((d) => rel === d + '/index.html');
  const isPost = /(^|\/)blog\/(?!index\.html)[^/]+\.html$/.test(rel);
  if (isHome) {
    graph.push({ '@type': 'WebSite', '@id': BASE + '/#website', url: BASE + '/', name: 'AI Summary Helper', inLanguage: lang, publisher: { '@id': publisher['@id'] } });
    graph.push({ '@type': 'SoftwareApplication', '@id': BASE + '/#app', name: 'AI Summary Helper', url: self, description: desc, applicationCategory: 'BrowserApplication', operatingSystem: 'Chrome, Chromium browsers, Firefox, Android (beta companion app)', installUrl: 'https://chromewebstore.google.com/detail/ai-summary-helper-openai/hldbejcjaedipeegjcinmhejdndchkmb', downloadUrl: 'https://addons.mozilla.org/en-US/firefox/addon/ai-summary-helper/', downloadUrl: STORE, image, inLanguage: lang,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: 'Free; a donation (Support Pass) unlocks byphil Cloud with many AI models' }, author: { '@id': publisher['@id'] }, publisher });
    const qa = [];
    $('.faq details').each((_, el) => { const q = $(el).find('summary').first().text().trim(), a = $(el).find('p').text().trim().replace(/\s+/g, ' '); if (q && a) qa.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }); });
    if (qa.length) graph.push({ '@type': 'FAQPage', '@id': self + '#faq', inLanguage: lang, mainEntity: qa });
  } else if ($('meta[name="aish:landing"]').length) {
    // Cluster landing pages (<meta name="aish:landing" content="...">): WebPage + FAQPage from the visible FAQ + breadcrumb back to the hub.
    const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
    graph.push({ '@type': 'WebPage', '@id': self + '#page', url: self, name: title, description: desc, inLanguage: lang, isPartOf: { '@id': BASE + '/#website' }, about: { '@id': BASE + '/#app' }, publisher: { '@id': publisher['@id'] } });
    const qa = [];
    $('.faq details').each((_, el) => { const q = $(el).find('summary').first().text().trim(), a = $(el).find('p').text().trim().replace(/\s+/g, ' '); if (q && a) qa.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }); });
    if (qa.length) graph.push({ '@type': 'FAQPage', '@id': self + '#faq', inLanguage: lang, mainEntity: qa });
    graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'AI Summary Helper', item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: h1 || title, item: self }] });
  } else if (isPost) {
    const h1 = $('h1').first().text().trim();
    const dt = monthIso($('.blog-date').first().text());
    const idx = self.replace(/[^/]*$/, '');
    graph.push({ '@type': 'BlogPosting', '@id': self + '#post', headline: h1 || title, description: desc, ...(dt ? { datePublished: dt } : {}), inLanguage: lang, image, mainEntityOfPage: self, author: { '@id': publisher['@id'] }, publisher });
    graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'AI Summary Helper', item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: 'Blog', item: idx }, { '@type': 'ListItem', position: 3, name: h1 || title, item: self }] });
  }
  if (!graph.length) return;
  $('head').append(`<script type="application/ld+json" data-seo="ld">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`);
}

const entries = [];
for (const file of walk(DOCS)) {
  const rel = path.relative(DOCS, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const $ = cheerio.load(html, { decodeEntities: false });
  const self = clean(rel);
  const noindex = /noindex/i.test($('meta[name="robots"]').attr('content') || '');
  $('link[rel="canonical"]').remove();
  $('head').append(`<link rel="canonical" href="${self}">`);
  if ($('meta[property="og:url"]').length) $('meta[property="og:url"]').attr('content', self);
  const alts = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const h = toUrl($(el).attr('href') || '');
    if (!targetExists(h)) { $(el).remove(); return; }   // untranslated page: an alternate that 404s invalidates the whole hreflang set
    $(el).attr('href', h);
    alts.push([$(el).attr('hreflang'), h]);
  });
  // Translated pages link to pages that are not translated (bookmarklet, some posts): point those links at the English page instead of a 404.
  if (isLocalized(rel)) {
    const locDir = LOCALE_DIRS.find((d) => rel.startsWith(d + '/'));
    $('a[href]').each((_, el) => {
      const raw = $(el).attr('href') || '';
      if (!raw || /^(https?:|mailto:|tel:|#|\/\/|javascript:)/.test(raw)) return;
      const m = raw.match(/^([^#?]*)([#?].*)?$/); const pathPart = m[1], rest = m[2] || '';
      if (!pathPart) return;
      const abs = path.join(path.dirname(file), pathPart);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return;
      if (fs.existsSync(path.join(abs, 'index.html'))) return;
      const inLocale = path.relative(path.join(DOCS, locDir), abs);
      if (inLocale.startsWith('..')) return;
      const en = path.join(DOCS, inLocale);
      const hit = fs.existsSync(en) && fs.statSync(en).isFile() ? en : (fs.existsSync(path.join(en, 'index.html')) ? en : null);
      if (!hit) return;
      let nr = path.relative(path.dirname(file), hit).split(path.sep).join('/');
      if (pathPart.endsWith('/') && !nr.endsWith('/')) nr += '/';
      $(el).attr('href', nr + rest);
    });
  }
  const lang = $('html').attr('lang') || 'en';
  const title = $('title').text().trim(), desc = $('meta[name="description"]').attr('content') || '';
  const ogImg = $('meta[property="og:image"]').attr('content') || DEFAULT_OG_IMAGE;
  setMeta($, 'property', 'og:site_name', 'AI Summary Helper');
  setMeta($, 'property', 'og:locale', OG_LOCALE[lang] || lang.replace('-', '_'));
  setMeta($, 'property', 'og:type', rel.includes('blog/') && !/blog\/index\.html$/.test(rel) ? 'article' : 'website');
  setMeta($, 'property', 'og:title', $('meta[property="og:title"]').attr('content') || title);
  setMeta($, 'property', 'og:description', desc);
  setMeta($, 'property', 'og:image', ogImg);
  setMeta($, 'name', 'twitter:card', 'summary_large_image');
  setMeta($, 'name', 'twitter:title', $('meta[property="og:title"]').attr('content') || title);
  setMeta($, 'name', 'twitter:description', $('meta[property="og:description"]').attr('content') || desc);
  setMeta($, 'name', 'twitter:image', ogImg);
  if (!noindex) jsonLd($, rel, self, lang, title, desc, ogImg);
  if (!noindex) videoPass($, file, self, lang);
  fs.writeFileSync(file, $.html());
  if (!noindex) {
    if (rel === 'goodbye.html' || rel.endsWith('/goodbye.html')) continue;
    entries.push({ rel, self, alts, mtime: fs.statSync(file).mtime, git: lastmod(path.join('docs', rel)), title, desc });
  }
}
entries.sort((a, b) => a.self.length - b.self.length || a.self.localeCompare(b.self));
const day = (d) => d.toISOString().slice(0, 10);
const prio = (e) => (e.self === BASE + '/' ? '1.0' : isLocalized(e.rel) ? '0.5' : /blog\//.test(e.rel) ? '0.7' : '0.8');
let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`;
for (const e of entries) {
  xml += `  <url>\n    <loc>${esc(e.self)}</loc>\n    <lastmod>${e.git || day(e.mtime)}</lastmod>\n    <priority>${prio(e)}</priority>\n`;
  for (const [l, h] of e.alts) xml += `    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(h)}"/>\n`;
  xml += `  </url>\n`;
}
xml += `</urlset>\n`;
fs.writeFileSync(path.join(DOCS, 'sitemap.xml'), xml);
// Identical copy under a second name: a fresh filename can get past a stuck "Couldn't fetch" in Search Console.
fs.writeFileSync(path.join(DOCS, 'sitemap-index.xml'), xml);
// Video sitemap: one <url> per page that shows videos, with a <video:video> per video (Google's video extension).
videoEntries.sort((a, b) => a.self.length - b.self.length || a.self.localeCompare(b.self));
let vxml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`;
for (const e of videoEntries) {
  vxml += `  <url>\n    <loc>${esc(e.self)}</loc>\n`;
  for (const v of e.videos) {
    vxml += `    <video:video>\n      <video:thumbnail_loc>${esc(v.thumb)}</video:thumbnail_loc>\n      <video:title>${esc(v.title)}</video:title>\n      <video:description>${esc(v.description)}</video:description>\n      <video:content_loc>${esc(v.content)}</video:content_loc>\n      <video:duration>${v.duration}</video:duration>\n      <video:publication_date>${v.date}</video:publication_date>\n      <video:family_friendly>yes</video:family_friendly>\n${v.english ? '      <video:tag>English original</video:tag>\n' : ''}    </video:video>\n`;
  }
  vxml += `  </url>\n`;
}
vxml += `</urlset>\n`;
fs.writeFileSync(path.join(DOCS, 'sitemap-video.xml'), vxml);
fs.writeFileSync(path.join(DOCS, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\nSitemap: ${BASE}/sitemap-index.xml\nSitemap: ${BASE}/sitemap-video.xml\n`);

// llms.txt: a plain-text map for AI assistants and answer engines (English pages only; each links to its translations via hreflang).
const en = entries.filter((e) => !isLocalized(e.rel));
const line = (e) => `- [${e.title.replace(/\s+[—-]\s+AI Summary Helper.*$/, '')}](${e.self}): ${e.desc}`;
const llms = [
  '# AI Summary Helper',
  '',
  '> AI Summary Helper is a browser extension (Chrome, Chromium-based browsers and Firefox, plus an Android companion app in beta) that summarizes web pages with the AI provider you choose (your own API key or a local Ollama model), follows sites with a built-in RSS reader, saves pages into a searchable on-device archive, and sends reading digests to Kindle or LocalSend. Search, de-duplication and recommendations run on the device.',
  '',
  '## Key facts',
  '- Free for everyone. A donation (Support Pass) unlocks byphil Cloud with many AI models and supports all byphil tools.',
  '- Bring your own key or run fully local with Ollama: only the summarization request leaves the browser.',
  `- Install (Chrome): ${STORE}`,
  `- Install (Firefox): https://addons.mozilla.org/en-US/firefox/addon/ai-summary-helper/`,
  `- Live demo (runs in the browser, nothing is sent anywhere): ${BASE}/demo/`,
  `- Android companion app (beta): https://github.com/philffm/ai-summary-helper/releases/latest/download/aish-companion.apk`,
  '- Source code: https://github.com/philffm/ai-summary-helper',
  '- Maker: byphil (https://byphil.eu/)',
  '',
  '## Pages',
  ...en.filter((e) => !/blog\//.test(e.rel)).map(line),
  '',
  '## Blog',
  ...en.filter((e) => /blog\//.test(e.rel)).map(line),
  '',
  '## Translations',
  `Home page and main guides are available in ${LOCALE_DIRS.length} languages under /<code>/ (for example /de/): ${LOCALE_DIRS.join(', ')}. Arabic (/ar/) is right-to-left. Every page declares its alternates with hreflang and lists them in the sitemap.`,
  '',
].join('\n');
fs.writeFileSync(path.join(DOCS, 'llms.txt'), llms);
console.log(`seo: ${entries.length} URLs in sitemap, ${videoEntries.reduce((n, e) => n + e.videos.length, 0)} videos on ${videoEntries.length} pages (sitemap-video.xml), canonical set on all pages`);
