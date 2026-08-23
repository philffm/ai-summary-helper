// digestBuilder.js
// Two jobs:
//   1. buildMagazineArticle() combines N saved articles into one
//      synthetic article-shaped object ({ title, content, summary, url }).
//      It plugs straight into the existing single-article pipeline —
//      sendToKindle(), dispatchToLocalSend(), exportToMarkdown(),
//      shareArticle() — none of which need to know a "magazine" concept
//      exists. No new delivery code required.
//   2. curateDigest() picks a good set of articles for that bundle
//      automatically: recency + TF-IDF topical diversity (reusing the
//      same index search/similar-articles already build) + an optional
//      mood filter using the sentiment scorer.

import { cosineSim } from './localSearch.js';
import { sentiment as scoreSentiment } from './textMetrics.js';

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Combine articles into one synthetic "magazine" article. Bundles
 * summaries (with source links), not full original content — a 5-article
 * bundle of full text would be huge and mostly redundant with just
 * reading each article individually.
 */
export function buildMagazineArticle(articles, { title } = {}) {
    const ordered = [...articles].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const magazineTitle = title || `Reading bundle — ${new Date().toLocaleDateString()} (${ordered.length} article${ordered.length === 1 ? '' : 's'})`;

    const toc = ordered.map((a, i) =>
        `<li><a href="#aish-mag-${i}">${escapeHtml(a.title || 'Untitled')}</a></li>`
    ).join('');

    const sections = ordered.map((a, i) => {
        const domain = a.url ? (() => { try { return new URL(a.url).hostname; } catch { return ''; } })() : '';
        return `
          <h2 id="aish-mag-${i}">${escapeHtml(a.title || 'Untitled')}</h2>
          <p style="color:#666;font-style:italic;">${a.url ? `<a href="${a.url}">${domain}</a> &middot; ` : ''}${new Date(a.timestamp).toLocaleDateString()}</p>
          <div>${a.summary || ''}</div>
          <hr />
        `;
    }).join('\n');

    const content = `
      <div>
        <h1>${escapeHtml(magazineTitle)}</h1>
        <p>${ordered.length} article${ordered.length === 1 ? '' : 's'}, curated from your AI Summary Helper archive.</p>
        <ol>${toc}</ol>
        <hr />
        ${sections}
      </div>
    `;

    return {
        title: magazineTitle,
        content,
        summary: `A bundle of ${ordered.length} article${ordered.length === 1 ? '' : 's'}: ${ordered.map(a => a.title).filter(Boolean).slice(0, 5).join(', ')}${ordered.length > 5 ? '…' : ''}`,
        url: '',
        timestamp: new Date().toISOString(),
        tags: Array.from(new Set(ordered.flatMap(a => a.tags || []))).slice(0, 10),
        isMagazine: true,
        articleCount: ordered.length,
        sourceTimestamps: ordered.map(a => a.timestamp)
    };
}

const RECENCY_HALF_LIFE_DAYS = 14;

function recencyScore(article) {
    const ageDays = (Date.now() - new Date(article.timestamp).getTime()) / 86400000;
    return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Picks up to maxArticles articles for a personal digest.
 *   - Candidate pool: explicit "Save for Later" articles first, topped up
 *     with the most recent other saves if there aren't enough.
 *   - Optional mood filter ('positive' | 'neutral' | 'negative' | 'any'):
 *     scores sentiment only for the (capped) candidate pool, not the
 *     whole archive, and falls back to the unfiltered pool if the filter
 *     would leave too little to choose from.
 *   - Greedy MMR-style selection: pick the best-recency article, then
 *     repeatedly pick whichever remaining candidate maximizes
 *     (recency - diversityWeight * similarity to what's already picked),
 *     using the shared TF-IDF index so the digest doesn't repeat the same
 *     story five times.
 *
 * @param {Array<object>} articles
 * @param {object|null} index - prebuilt TF-IDF index from localSearch.js
 * @param {{ maxArticles?: number, mood?: string, poolSize?: number }} opts
 */
export async function curateDigest(articles, index, { maxArticles = 5, mood = 'any', poolSize = 25 } = {}) {
    let pool = articles.filter(a => a.isDecision);
    if (pool.length < maxArticles) {
        const rest = articles
            .filter(a => !a.isDecision)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        pool = pool.concat(rest);
    }
    pool = pool.slice(0, poolSize); // cap sentiment-scoring cost on large archives

    let scoredPool = pool.map(a => ({ article: a, recency: recencyScore(a) }));

    if (mood && mood !== 'any') {
        const withMood = await Promise.all(scoredPool.map(async entry => {
            const s = await scoreSentiment(entry.article.summary || entry.article.content || '');
            return { ...entry, moodLabel: (s?.label || 'Neutral').toLowerCase() };
        }));
        const filtered = withMood.filter(e => e.moodLabel === mood.toLowerCase());
        // If the filter is too strict to build a real digest, fall back
        // rather than returning something tiny or empty.
        scoredPool = filtered.length >= Math.min(3, maxArticles) ? filtered : withMood;
    }

    if (scoredPool.length === 0) return [];

    const DIVERSITY_WEIGHT = 0.6;
    const remaining = [...scoredPool].sort((a, b) => b.recency - a.recency);
    const selected = [remaining.shift()];

    while (selected.length < maxArticles && remaining.length > 0) {
        let bestIdx = 0;
        let bestScore = -Infinity;
        remaining.forEach((entry, i) => {
            const vec = index?.vectors?.get(entry.article.timestamp);
            let maxSim = 0;
            if (vec) {
                for (const s of selected) {
                    const sVec = index?.vectors?.get(s.article.timestamp);
                    if (sVec) maxSim = Math.max(maxSim, cosineSim(vec, sVec));
                }
            }
            const score = entry.recency - DIVERSITY_WEIGHT * maxSim;
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        });
        selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    return selected.map(s => s.article);
}
