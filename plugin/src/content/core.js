import { SK, articleRecKey } from '../modules/storageKeys.js';
import { unwrapArchiveUrl } from '../modules/archiveUrl.js';
import { debug } from '../modules/log.js';
import { detectPaper } from './paper.js';
import { asCategory, categoryFromText } from '../modules/topicCategories.js';
// content/core.js
// Core helpers for the content script: tag generation, ghost-quote parsing,
// storage saving, and the Safari-safe streaming port connection.

// Japanese and Chinese (and Thai) are written without spaces: splitting on whitespace counts a whole paragraph as
// one word. Count those scripts by characters instead (about 2 CJK / 5 Thai characters per English-word equivalent),
// so reading time, "time saved" and "words read" stay comparable across languages.
const CJK_CHARS = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
const THAI_CHARS = /[\u0e00-\u0e7f]/g;
function countWords(html) {
  const text = (html || '').replace(/<[^>]+>/g, ' ');
  const cjk = (text.match(CJK_CHARS) || []).length;
  const thai = (text.match(THAI_CHARS) || []).length;
  const spaced = text.replace(CJK_CHARS, ' ').replace(THAI_CHARS, ' ').split(/\s+/).filter(Boolean).length;
  return spaced + Math.round(cjk / 2) + Math.round(thai / 5);
}

/**
 * Save an article to local storage.
 *
 * Storage is split into a small 'articlesIndex' (everything list/search/
 * graph/analytics views need) plus one 'article:<id>' record per article
 * (full content, loaded only when that article is opened) — see
 * StorageManager.saveArticle() in modules/storageManager.js, which this
 * mirrors. Content scripts can't import that module (the build's content
 * script bundler only inlines relative imports under src/content/, and
 * doesn't resolve modules/storageManager.js's default export), so the same
 * shape is written by hand here via raw chrome.storage.local calls.
 */
/** Page metadata worth keeping with a summary (shown again when the conversation is resumed). All fields optional, capped. */
export function collectPageMeta(doc = document, loc = window.location) {
  const cap = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const attr = (sel, a = 'content') => { const el = doc.querySelector(sel); return el ? el.getAttribute(a) || '' : ''; };
  const abs = (u) => { try { return u ? new URL(u, loc.href).href : ''; } catch (_) { return ''; } };
  const iconEl = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  const meta = {
    description: cap(attr('meta[name="description"]') || attr('meta[property="og:description"]') || attr('meta[name="twitter:description"]'), 400),
    favicon: cap(abs(iconEl ? iconEl.getAttribute('href') : '') || (loc.origin && loc.origin !== 'null' ? loc.origin + '/favicon.ico' : ''), 400),
    siteName: cap(attr('meta[property="og:site_name"]'), 80),
    image: cap(abs(attr('meta[property="og:image"]')), 400),
    author: cap(attr('meta[name="author"]') || attr('meta[property="article:author"]'), 120),
    published: cap(attr('meta[property="article:published_time"]') || attr('meta[name="date"]'), 40),
    lang: cap(doc.documentElement ? doc.documentElement.getAttribute('lang') : '', 20)
  };
  Object.keys(meta).forEach(k => { if (!meta[k]) delete meta[k]; });
  try { const paper = detectPaper(doc, loc); if (paper) meta.paper = paper; } catch (_) { /* detection is optional */ }
  return meta;
}

export function saveToLocalStorage(content, summary, url, title, description, tags = [], modelId = '', summaryLength = 200, moodScore, extra, pageMeta) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString();
    const id = `article_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // lastOpened starts equal to the save time: a freshly saved article is
    // by definition "opened" the moment it's created, so it shouldn't be
    // flagged as neglected until it's actually sat unopened for a while.
    // saved from archive.ph / Wayback / 12ft…: keep the original article URL, remember the archive copy
    const originalUrl = unwrapArchiveUrl(url);
    const indexEntry = {
      id, title: title || 'Untitled', url: originalUrl, timestamp, tags, modelId, summaryLength,
      summary: summary || '',
      contentWordCount: countWords(content || ''),
      summaryWordCount: countWords(summary || ''),
      archived: false,
      lastOpened: timestamp
    };
    if (originalUrl !== url) indexEntry.archiveUrl = url;
    if (typeof moodScore === 'number' && isFinite(moodScore)) indexEntry.moodScore = moodScore;
    if (pageMeta && pageMeta.favicon) indexEntry.favicon = pageMeta.favicon;   // lean: lists can show it without loading the record
    if (extra && typeof extra === 'object') Object.assign(indexEntry, extra);
    const record = { content, summary, description: description || (pageMeta && pageMeta.description) || '' };
    if (pageMeta && Object.keys(pageMeta).length) record.meta = pageMeta;

    chrome.storage.local.get({ [SK.articlesIndex]: [] }, (data) => {
      const articlesIndex = data[SK.articlesIndex] || [];
      articlesIndex.push(indexEntry);
      chrome.storage.local.set({ [SK.articlesIndex]: articlesIndex, [articleRecKey(id)]: record }, () => {
        const articleData = { ...indexEntry, ...record };
        debug('Article saved to local storage');
        resolve(articleData);
      });
    });
  });
}

/**
 * Ghost-highlight config based on the user's setting.
 */
export function getGhostHighlightConfig(setting = 'regular') {
  switch (setting) {
    case 'few':
      return { promptRange: '1-2', max: 2 };
    case 'a_lot':
      return { promptRange: '4-6', max: 6 };
    default:
      return { promptRange: '2-3', max: 3 };
  }
}

/**
 * Normalize ghost quotes (dedupe, trim, cap count).
 */
export function normalizeGhostQuotes(quotes, maxCount = 3) {
  if (!Array.isArray(quotes)) return [];
  const seen = new Set();
  const normalized = [];

  for (const q of quotes) {
    const clean = (q || '').toString().replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 5) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= maxCount) break;
  }

  return normalized;
}

/**
 * The tags an article is saved with: one category from the fixed list (topicCategories.js) first, then the specific tags.
 * The category is the one the model chose; only when it chose none is it taken from the text (the category whose words occur most).
 * Nothing else is added: tags used often elsewhere are NOT attached by word match any more (that made the most used tags spread
 * to ever more articles), and there is no "General" (it said nothing). Async for the callers that await it.
 */
export async function ensureGeneralTag(tags, contentText = '', pageTitle = '', maxTags = 7, { category = '' } = {}) {
  const specific = [];
  const seen = new Set();
  let chosen = asCategory(category);
  for (const raw of Array.isArray(tags) ? tags : []) {
    const clean = (raw || '').toString().trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (asCategory(clean) || key === 'general') { if (!chosen) chosen = asCategory(clean); continue; }   // a category among the tags is the category
    if (seen.has(key)) continue;
    seen.add(key);
    specific.push(clean);
  }
  if (!chosen) chosen = categoryFromText(`${pageTitle || ''}\n${contentText || ''}\n${specific.join(' ')}`);
  return (chosen ? [chosen] : []).concat(specific).slice(0, maxTags);
}

/**
 * Pull the AI summary's own <h2> heading as a title fallback, for pages
 * (PDFs especially, but not exclusively) where document.title is empty or
 * unusable. The system prompt always asks for an <h2>, so this is real,
 * meaningful, AI-generated text — not a placeholder.
 *
 * @param {string} html - the cleaned summary HTML (post tag/ghost-quote strip)
 * @returns {string} the heading text, or '' if none found
 */
export function extractSummaryTitle(html) {
  const match = (html || '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').trim();
}
