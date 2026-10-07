import { SK, articleRecKey } from '../modules/storageKeys.js';
import { debug } from '../modules/log.js';
// content/core.js
// Core helpers for the content script: tag generation, ghost-quote parsing,
// storage saving, and the Safari-safe streaming port connection.

/**
 * Get the most-used tags from the user's saved articles.
 */
export function getTopUserTags(limit = 10) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [SK.articlesIndex]: [] }, (data) => {
      const tagCounts = {};
      const articles = data[SK.articlesIndex] || [];
      articles.forEach(art => {
        if (Array.isArray(art.tags)) {
          art.tags.forEach(t => {
            const clean = (t || '').toString().trim();
            if (!clean) return;
            const key = clean.toLowerCase();
            tagCounts[key] = {
              original: clean,
              count: (tagCounts[key]?.count || 0) + 1
            };
          });
        }
      });
      const sorted = Object.values(tagCounts).sort((a, b) => b.count - a.count);
      resolve(sorted.slice(0, limit).map(item => item.original));
    });
  });
}

function countWords(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
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
  return meta;
}

export function saveToLocalStorage(content, summary, url, title, description, tags = [], modelId = '', summaryLength = 200, moodScore, extra, pageMeta) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString();
    const id = `article_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // lastOpened starts equal to the save time: a freshly saved article is
    // by definition "opened" the moment it's created, so it shouldn't be
    // flagged as neglected until it's actually sat unopened for a while.
    const indexEntry = {
      id, title: title || 'Untitled', url, timestamp, tags, modelId, summaryLength,
      summary: summary || '',
      contentWordCount: countWords(content || ''),
      summaryWordCount: countWords(summary || ''),
      archived: false,
      lastOpened: timestamp
    };
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
 * Ensure a general/broad tag is present, combining AI tags with historical
 * user tags and a broad fallback catalog.
 */
export async function ensureGeneralTag(tags, contentText = '', pageTitle = '', maxTags = 7) {
  const inputTags = Array.isArray(tags) ? tags : [];
  const normalized = [];
  const seen = new Set();

  for (const raw of inputTags) {
    const clean = (raw || '').toString().trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
  }

  // Fetch top 10 most used tags from storage library
  const topUserTags = await getTopUserTags(10);
  const corpus = `${pageTitle || ''}\n${contentText || ''}\n${normalized.join(' ')}`.toLowerCase();

  // Check if any of your top historical tags match the current article content
  const matchedHistoricalTags = topUserTags.filter(ut => {
    const term = ut.toLowerCase();
    // Match whole-word occurrences to avoid false positives
    const rx = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return rx.test(corpus) && !seen.has(term);
  });

  // Broad fallback catalog if no specific match occurs
  const broadCatalog = [
    { tag: 'Technology', patterns: [/\bai\b/i, /\bartificial intelligence\b/i, /\bsoftware\b/i, /\btech\b/i, /\btechnology\b/i, /\bcyber\b/i, /\bstartup\b/i, /\bsemiconductor\b/i, /\bcloud\b/i] },
    { tag: 'Business', patterns: [/\bfinance\b/i, /\beconomy\b/i, /\beconomic\b/i, /\bcorporate\b/i, /\bmarket\b/i, /\bhiring\b/i, /\bprofit\b/i, /\brevenue\b/i, /\bindustry\b/i] },
    { tag: 'Science', patterns: [/\bscience\b/i, /\bresearch\b/i, /\bstudy\b/i, /\banalysis\b/i, /\bevidence\b/i, /\bexperiment\b/i, /\bjournal\b/i] },
    { tag: 'Health', patterns: [/\bhealth\b/i, /\bmedical\b/i, /\bdisease\b/i, /\bdoctor\b/i, /\bhospital\b/i, /\bphysiology\b/i, /\bnutrition\b/i] },
    { tag: 'Politics', patterns: [/\bgovernment\b/i, /\belection\b/i, /\bgeopolitics?\b/i, /\bregulations?\b/i] },
    { tag: 'Environment', patterns: [/\bclimate\b/i, /\bemissions?\b/i, /\bsustainab(le|ility)\b/i, /\benvironment\b/i, /\brenewable\b/i, /\bbiodiversity\b/i, /\bweather\b/i] },
    { tag: 'Society', patterns: [/\bculture\b/i, /\bcommunity\b/i, /\beducation\b/i, /\bdemographics?\b/i] },
    { tag: 'Lifestyle', patterns: [/\blifestyle\b/i, /\bcreativity\b/i, /\bmindset\b/i, /\bhabits?\b/i, /\bwellbeing\b/i] }
  ];

  let broadTag = normalized.find(tag => broadCatalog.some(b => b.tag.toLowerCase() === tag.toLowerCase())) || '';

  if (!broadTag) {
    for (const broad of broadCatalog) {
      if (broad.patterns.some(rx => rx.test(corpus))) {
        broadTag = broad.tag;
        break;
      }
    }
  }

  if (!broadTag) broadTag = 'General';

  // Combine broad tag, matched historical tags, and AI-generated tags up to maxTags limit
  const combinedSpecific = [...matchedHistoricalTags, ...normalized.filter(tag => tag.toLowerCase() !== broadTag.toLowerCase())];
  const uniqueSpecific = [];
  const specificSeen = new Set();
  for (const t of combinedSpecific) {
    const k = t.toLowerCase();
    if (!specificSeen.has(k)) {
      specificSeen.add(k);
      uniqueSpecific.push(t);
    }
  }

  const cappedSpecific = uniqueSpecific.slice(0, Math.max(0, maxTags - 1));

  // Final dedup: ensure broadTag isn't duplicated in the result
  const finalTags = [broadTag];
  const finalSeen = new Set([broadTag.toLowerCase()]);
  for (const t of cappedSpecific) {
    const k = t.toLowerCase();
    if (!finalSeen.has(k)) {
      finalSeen.add(k);
      finalTags.push(t);
    }
  }
  return finalTags;
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
