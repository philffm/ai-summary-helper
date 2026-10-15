// payload.js — builds what an adapter receives, from an article id and a format. Runs in the background worker, so no DOM:
//   'md'       the Markdown note (same builder as the archive export)
//   'json-v1'  AISH Article JSON v1 without `blocks` (those need a DOM; they come later through the offscreen document)
import { SK, articleRecKey } from '../storageKeys.js';
import { pageKeyForUrl } from '../pageKey.js';
import { articleToMarkdown } from '../markdownArchive.js';
import { toArticleJson, safeFileName, idTail } from '../articleFormat.js';
import { oneLine } from '../articleMeta.js';

export const FORMATS = ['md', 'json-v1'];

/**
 * @returns {Promise<null | {format, mime, text, ext, articleId, fileBase, fileBaseWithId}>} null when the article is gone.
 *   fileBase is the plain title; fileBaseWithId adds " (<id tail>)". Only the target knows about collisions, so the adapter picks.
 */
export async function buildPayload({ articleId, format, storage, includeBlocks = false }) {
    if (!FORMATS.includes(format)) throw new Error(`Unknown format: ${format}`);
    if (includeBlocks) throw new Error('Full-text blocks are not available in the background worker yet (they need the offscreen document).');
    const idx = (await storage.get([SK.articlesIndex]))[SK.articlesIndex];
    const entry = (Array.isArray(idx) ? idx : []).find((a) => a && a.id === articleId && !a.feedStub && !a.savedOnly);
    if (!entry) return null;
    const rec = (await storage.get([articleRecKey(articleId)]))[articleRecKey(articleId)] || {};
    const full = { ...entry, ...rec };
    const all = (await storage.get([SK.annotations]))[SK.annotations];
    const key = full.url ? pageKeyForUrl(full.url) : '';
    const highlights = (Array.isArray(all) ? all : []).filter((h) => h && h.url === key && !h.dismissed);
    const conversation = Array.isArray(rec.conversation) ? rec.conversation : [];

    const titled = !!oneLine(full.title);
    const withId = `${titled ? safeFileName(full.title) : 'Untitled'} (${idTail(full.id)})`;
    const common = { articleId, fileBase: titled ? safeFileName(full.title) : withId, fileBaseWithId: withId };
    if (format === 'md') return { ...common, format, mime: 'text/markdown', ext: 'md', text: articleToMarkdown(full, { highlights, conversation }) };
    return { ...common, format, mime: 'application/json', ext: 'json', text: JSON.stringify(toArticleJson(full, { highlights, conversation }), null, 2) };
}
