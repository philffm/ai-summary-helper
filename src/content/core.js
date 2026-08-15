// content/core.js
// Core helpers for the content script: tag generation, ghost-quote parsing,
// storage saving, and the Safari-safe streaming port connection.

/**
 * Get the most-used tags from the user's saved articles.
 */
export function getTopUserTags(limit = 10) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ articles: [] }, (data) => {
      const tagCounts = {};
      const articles = data.articles || [];
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

/**
 * Save an article to local storage.
 */
export function saveToLocalStorage(content, summary, url, title, description, tags = [], modelId = '', summaryLength = 200) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString();
    const articleData = { content, summary, url, title, description, timestamp, tags, modelId, summaryLength };

    chrome.storage.local.get({ articles: [] }, (data) => {
      const articles = data.articles || [];
      articles.push(articleData);
      chrome.storage.local.set({ articles }, () => {
        console.log('Article saved to local storage:', articleData);
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
