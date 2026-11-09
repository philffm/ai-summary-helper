// history/export.js — export and send one saved article: Markdown, Word, PDF, HTML file, clipboard, Obsidian, Kindle,
// LocalSend/KOReader, phone. Loaded the first time one of these is used (articleManager.js re-exports thin wrappers).
import { SK } from '../storageKeys.js';
import { escapeHtml } from '../textUtils.js';
import StorageManager from '../storageManager.js';
import { normalizeKindleFormat } from '../kindleFormat.js';
import { sendToLocalSend } from '../localSendClient.js';
import { T } from '../feedI18n.js';
import { withQuestions, qaMarkdown } from '../conversation.js';
import { paperState, paperDoi } from '../paperInfo.js';
import { createInboxManager } from '../inboxManager.js';
import { articleForPhone } from '../articleBlocks.js';
import { assignFileBases, safeFileName } from '../articleFormat.js';
import { obsidianUri } from '../obsidianUri.js';
import { buildAnnotationsSection, fetchAnnotationsForArticle, buildAnnotationsPlainText, markHighlights } from '../annotationExporter.js';
import { hist } from './state.js';
import { applyStatus } from '../articleManager.js';

const escAttr = escapeHtml;

function buildSafeArticleTitle(title) {
    return (title || 'AI Summary').replace(/[^a-z0-9_-]/gi, '_');
}

export async function includeAllQuestions() {
    try { return !!(await StorageManager.getLocal({ [SK.exportAllQuestions]: false }))[SK.exportAllQuestions]; } catch (_) { return false; }
}
async function conversationOf(article) {
    return Array.isArray(article.conversation) ? article.conversation : (article.id ? StorageManager.getConversation(article.id) : []);
}
/** Article copy whose summary also carries the pinned questions (all of them when "Include all questions" is on). */
export async function exportView(article) {
    const turns = await conversationOf(article);
    if (!turns.length) return article;
    let base = article.summaryBase;
    if (base === undefined && article.id) {   // lean index entries already carry the pinned block: start from the original text
        try { const full = await StorageManager.getArticleFull(article.id); base = full.summaryBase !== undefined ? full.summaryBase : full.summary; } catch (_) { /* fall back below */ }
    }
    return { ...article, summary: withQuestions(base !== undefined ? base : article.summary, turns, { all: await includeAllQuestions() }) };
}

async function buildArticleDocumentHtml(article) {
    article = await exportView(article);
    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    // One pass over the document: a highlight is marked once (full text wins over the summary).
    const placed = new Set();
    const contentHtml = markHighlights(article.content, annotations, placed);
    const summaryHtml = markHighlights(article.summary, annotations, placed);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(article.title || 'AI Summary')}</title>
<style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}img{max-width:100%;height:auto;}</style>
</head><body><h1>${escapeHtml(article.title || 'AI Summary')}</h1>
<div class="meta">Captured via AI Summary Helper &middot; <a href="${escAttr(article.url || '#')}">Source</a></div>
${summaryHtml ? `<div class="summary"><h2>🧙 AI Summary</h2>${summaryHtml}</div>` : ''}
${annotationsHtml}
${contentHtml ? `<h2>📄 Content</h2><div>${contentHtml}</div>` : ''}</body></html>`;
}

export const __test_buildDoc = (a) => buildArticleDocumentHtml(a);

async function buildArticleHtmlFile(article) {
    const safeTitle = buildSafeArticleTitle(article.title);
    const fileName = `${safeTitle}.html`;
    const docHtml = await buildArticleDocumentHtml(article);
    const blob = new Blob([docHtml], { type: 'text/html' });
    const file = new File([blob], fileName, { type: 'text/html' });
    return { file, fileName, docHtml };
}

/**
 * Triggers the native OS share sheet
 */
export async function shareArticle(article) {
    if (!navigator.share) {
        if (hist.ui) hist.ui.showToast(T('Sharing is not supported in this browser/environment.'));
        else alert(T('Sharing is not supported in this browser/environment.'));
        return;
    }

    try {
        const { file } = await buildArticleHtmlFile(article);
        const fileShareData = {
            title: article.title || 'AI Summary',
            files: [file]
        };

        // Prefer file sharing so AirDrop imports as an offline document.
        if (navigator.canShare && navigator.canShare(fileShareData)) {
            await navigator.share(fileShareData);
            if (hist.ui) hist.ui.showToast(T('File shared successfully.'));
            return;
        }

        // Fallback for environments that only support URL/text share.
        await navigator.share({
            title: article.title || 'AI Summary',
            text: `Check out this summary: \n\n${article.summary || ''}\n\nRead more at:`,
            url: article.url || ''
        });
    } catch (err) {
        console.error('Share failed:', err);
        if (hist.ui && err?.name !== 'AbortError') {
            hist.ui.showToast(T('Share failed: {message}', { message: err?.message || T('Unknown error') }));
        }
    }
}
/** The article as one Markdown note (YAML front matter, summary, Q&A, highlights, original text). */
export async function buildMarkdown(article) {
    // The list passes lean index entries (no page text): the original content lives in the full record.
    if (article && article.id && !article.content) {
        try { const full = await StorageManager.getArticleFull(article.id); if (full) article = { ...article, ...full }; } catch (_) { /* export what we have */ }
    }
    // 1. Format date as YYYY-MM-DD for Obsidian frontmatter
    const createdDate = new Date(article.timestamp).toISOString().split('T')[0];
    
    const yamlStr = (value) => JSON.stringify(String(value ?? ''));
    const safeTitle = yamlStr(article.title || 'Untitled Article');

    // 3. Format tags into YAML list format
    let tagsFrontmatter = 'tags:';
    if (article.tags && article.tags.length > 0) {
        tagsFrontmatter += '\n' + article.tags.map(tag => `  - ${yamlStr(tag)}`).join('\n');
    }

    // Paper fields (only for pages detected / marked as papers)
    const pm = (paperState(article) && article.meta && article.meta.paper) || {};
    const doi = paperState(article) ? paperDoi(article) : '';
    const paperFm = (doi ? `\ndoi: ${yamlStr(doi)}` : '') + (pm.journal ? `\njournal: ${yamlStr(pm.journal)}` : '') + (paperState(article) ? '\ntype: paper' : '');

    // 4. Construct the YAML Frontmatter
    const frontmatter = `---
title: ${safeTitle}
source: ${yamlStr(article.url || '')}
author: ${yamlStr(pm.authors || (article.meta && article.meta.author) || '')}
published: ${yamlStr(pm.year || '')}
created: ${createdDate}${paperFm}
description: 
${tagsFrontmatter}
bookrecs: 
why: ${article.id ? `\naish_id: ${yamlStr(article.id)}` : ''}
aish_format: 1
---`;

    // 5. Construct the Markdown Body — convert vanilla <img> and <a> to Markdown
    const baseSummary = article.summaryBase !== undefined ? article.summaryBase : article.summary;
    const summaryPlain = baseSummary ? baseSummary.replace(/<[^>]+>/g, '').trim() : 'No summary available.';

    // Parse stored clean HTML and convert tags to Markdown syntax
    const parser = new DOMParser();
    const doc = parser.parseFromString(article.content || '', 'text/html');

    // Convert <img> to ![alt](src)
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
        const alt = img.getAttribute('alt') || 'image';
        const src = img.getAttribute('src') || '';
        if (src) {
            const mdSyntax = `\n\n![${alt}](${src})\n\n`;
            img.parentNode.replaceChild(doc.createTextNode(mdSyntax), img);
        } else {
            img.remove();
        }
    });

    // Convert <a> to [text](url)
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
        const text = link.textContent.trim() || 'Link';
        const href = link.getAttribute('href') || '';
        if (href) {
            const mdSyntax = `[${text}](${href})`;
            link.parentNode.replaceChild(doc.createTextNode(mdSyntax), link);
        }
    });

    const contentPlain = doc.body.textContent || 'No content available.';

    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotationsPlain = await buildAnnotationsPlainText(article);

    const qaMd = qaMarkdown(await conversationOf(article), { all: await includeAllQuestions() });
    const mdContent = `${frontmatter}

# Summary
${summaryPlain}
${qaMd ? '\n' + qaMd : ''}
${annotationsPlain}

---

## 📝 Original Content
${contentPlain.trim().replace(/\n{3,}/g, '\n\n')}
`;
    return { mdContent, createdDate };
}

const markdownFileBase = (article, createdDate) => `${createdDate}_${(article.title || 'article').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_summary`;

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportToMarkdown(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    downloadBlob(new Blob([mdContent], { type: 'text/markdown' }), `${markdownFileBase(article, createdDate)}.md`);
}

/** Word (.docx) export of the same note — no library: markdownToDocx writes the few XML parts Word needs. */
export async function exportToWord(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    const { markdownToDocx } = await import('../docxExport.js');
    downloadBlob(await markdownToDocx(mdContent.replace(/^---\n[\s\S]*?\n---\n/, '')), `${markdownFileBase(article, createdDate)}.docx`);
}

/** Text document (.odt, OpenDocument): opens in LibreOffice, OnlyOffice, Pages, Nextcloud and Word. */
export async function exportToDocument(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    const { markdownToOdt } = await import('../odtExport.js');
    downloadBlob(await markdownToOdt(mdContent.replace(/^---\n[\s\S]*?\n---\n/, '')), `${markdownFileBase(article, createdDate)}.odt`);
}

/** PDF: the reader page in print mode — the browser's "Save as PDF" gives a clean, typeset document. */
export async function exportToPdf(article) {
    if (!article.id) return;
    const url = chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(article.id) + '&print=1';
    try { if (chrome.tabs && chrome.tabs.create) { await chrome.tabs.create({ url }); return; } } catch (_) { /* fall through */ }
    window.open(url, '_blank', 'noopener');
}

/**
 * Obsidian: the note goes through the clipboard (a URI is too short for long articles), then obsidian://new opens it.
 * Vault and folder come from Settings › Send & Share › Obsidian; the file name is the archive export's stable name.
 */
export async function sendToObsidian(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    let vault = '', folder = '', name = safeFileName(article.title);
    try { const p = await chrome.storage.sync.get({ obsidianVault: '', obsidianFolder: '' }); vault = p.obsidianVault; folder = p.obsidianFolder; } catch (_) { /* defaults */ }
    try {
        const idx = (await chrome.storage.local.get({ [SK.articlesIndex]: [] }))[SK.articlesIndex] || [];
        const n = assignFileBases(idx.filter(a => a && a.id && !a.feedStub && !a.savedOnly)).get(article.id);
        if (n) name = n;
    } catch (_) { /* title only */ }
    try { await navigator.clipboard.writeText(mdContent); }
    catch (_) { downloadBlob(new Blob([mdContent], { type: 'text/markdown' }), `${markdownFileBase(article, createdDate)}.md`); return; }
    const a = document.createElement('a');
    a.href = obsidianUri({ name, vault, folder });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/**
 * Copies summary and content to clipboard as formatted text (HTML) and plain text (Markdown-ish)
 */
export async function copyArticleToClipboard(article) {
    article = await exportView(article);
    const title = article.title || 'AI Summary';
    const summary = article.summary || '';
    const content = article.content || '';

    // Fetch annotations (user + ghost) once and reuse for both mime types.
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    const annotationsPlain = await buildAnnotationsPlainText(article, annotations);

    const placedSet = new Set();
    const contentMarked = markHighlights(content, annotations, placedSet);   // full text first, summary only for the rest
    const summaryMarked = markHighlights(summary, annotations, placedSet);

    // Create a clean HTML version for the clipboard
    const cleanHtml = `
        <div style="font-family: sans-serif;">
            <h1>${escapeHtml(title)}</h1>
            <p><a href="${escAttr(article.url)}">${escapeHtml(article.url)}</a></p>
            <hr>
            <h2>🧙 AI Summary</h2>
            <div>${summaryMarked}</div>
            ${annotationsHtml ? `<hr><div>${annotationsHtml}</div>` : ''}
            <hr>
            <h2>📄 Original Content</h2>
            <div>${contentMarked}</div>
        </div>
    `.replace(/style="[^"]*"/gi, (match) => {
        // Keep ONLY the top-level font family for the container, strip all other styles
        return match.includes('font-family: sans-serif') ? match : '';
    });

    // Create a plain text / markdown version
    const plainText = `# ${title}\nSource: ${article.url || 'N/A'}\n\n## 🧙 AI SUMMARY\n${summary.replace(/<[^>]+>/g, '').trim()}\n\n${annotationsPlain}\n\n---\n\n## 📄 ORIGINAL CONTENT\n${content.replace(/<[^>]+>/g, '').trim()}`;

    try {
        const typeHtml = 'text/html';
        const typePlain = 'text/plain';
        const blobHtml = new Blob([cleanHtml], { type: typeHtml });
        const blobPlain = new Blob([plainText], { type: typePlain });
        
        const data = [new ClipboardItem({
            [typeHtml]: blobHtml,
            [typePlain]: blobPlain
        })];

        await navigator.clipboard.write(data);
        if (hist.ui) hist.ui.showToast(T('Copied to clipboard! 📋'));
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        // Fallback for cases where ClipboardItem might fail
        try {
            await navigator.clipboard.writeText(plainText);
            if (hist.ui) hist.ui.showToast(T('Copied as plain text.'));
        } catch (e) {
            console.error('Final copy fallback failed:', e);
        }
    }
}


/**
 * Sends article summary and content to a Kindle email via the proxy API
 */
export async function sendToKindle(article) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    // Multiple Kindle devices can be configured; always send to the active
    // one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'kindle');
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) {
        if (hist.ui) {
            hist.ui.showToast(T('Set your Kindle email in Settings first.'));
            hist.ui.showScreen('settings');
            import('../settingsNav.js').then(m => m.openSettingsPanel('send', 'newKindleEmail')).catch(() => {});
        } else {
            alert(T('Please configure your Kindle delivery email address inside settings first.'));
        }
        return;
    }

    const isPro = config[SK.user]?.subscription_status === 'active';
    if (!isPro) {
        const confirmation = await (await import('../confirmSheet.js')).confirmSheet({ title: T('Send to Kindle'), confirmLabel: T('Send'), danger: false, text: T('📚 Send to Kindle\n\nFree tier: 3 Kindle sends included.\nUpgrade to Pro for unlimited.\n\nMake sure kindle@byphil.eu is in your Kindle approved senders list (see Amazon help).\n\nSend this article to Kindle?') });
        if (!confirmation) return;
    }

    // Content now arrives pre-optimized from content capture.
    if (hist.ui) {
        hist.ui.showToast(T('Preparing Kindle delivery... ⏳'), 3000);
    }

    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) {
            headers['Authorization'] = `Bearer ${config[SK.token]}`;
        } else if (config[SK.licenseKey]) {
            headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        }

        const annotations = await fetchAnnotationsForArticle(article);
        const annotationsHtml = await buildAnnotationsSection(article, annotations);

        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST',
            headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                format: normalizeKindleFormat(config.kindleFormat),
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
            if (hist.ui) hist.ui.showToast(T('Sent to Kindle! 📚'));
            if (device) StorageManager.setActiveDevice('kindle', device.id);
            if (article.id) applyStatus([article.id], { sent: { kind: 'kindle', label: device?.label || '' } }).catch(() => {});
        } else {
            const msg = resData.error || T('Kindle delivery failed.');
            if (resData.error?.includes('Free tier limit') || resData.error?.includes('402')) {
                alert(T('📚 Free tier limit reached (3 sends).\n\nUpgrade to Pro for unlimited Kindle delivery.\n\nhttps://philwornath.com/links'));
            } else if (hist.ui) {
                hist.ui.showToast(msg);
            } else {
                alert(msg);
            }
        }
    } catch (err) {
        console.error('Kindle dispatch error:', err);
        if (hist.ui) hist.ui.showToast(T('Network error sending to Kindle.'));
    }
}

export async function dispatchToLocalSend(article) {
    const config = await StorageManager.getAll();
    // Multiple LocalSend receivers can be configured; always send to the
    // active one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'localsend');
    const readerIp = (device?.addresses?.[0] || '').trim();

    if (!readerIp) {
        if (hist.ui) {
            hist.ui.showToast(T('Please set your LocalSend IP in Settings first.'));
            hist.ui.showScreen('settings');
            import('../settingsNav.js').then(m => m.openSettingsPanel('send', 'newLocalSendIp')).catch(() => {});
        } else {
            alert(T('Configure your LocalSend IP address inside settings first.'));
        }
        return;
    }

    if (hist.ui) hist.ui.showToast(T('Sending to LocalSend over Wi-Fi... 🚀'));

    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);

        await sendToLocalSend(readerIp, fileName, docHtml, 'text/html');

        if (hist.ui) hist.ui.showToast(T('Sent successfully! 📖'));
        if (device) StorageManager.setActiveDevice('localsend', device.id);
        if (article.id) applyStatus([article.id], { sent: { kind: 'localsend', label: device?.label || '' } }).catch(() => {});
    } catch (err) {
        console.error('[LocalSend Error]', err);
        if (hist.ui) hist.ui.showToast(T('Transfer failed: {message}', { message: err?.message || T('Check if receiver is online.') }));
    }
}

/** Sends the article's full text to the paired phone (end-to-end encrypted through the byPhil inbox) to read on the go. */
export async function sendToPhone(article) {
    const toast = (m) => { if (hist.ui) hist.ui.showToast(m); };
    const openPanel = () => import('../settingsNav.js').then((m) => m.openSettingsPanel('phoneinbox')).catch(() => {});
    const mgr = createInboxManager();
    try {
        if (!(await mgr.status()).paired) {
            toast(T('Pair your phone first: Settings → Phone inbox.'));
            if (hist.ui) hist.ui.showScreen('settings');
            openPanel();
            return;
        }
        let full = article;
        if (article.id && article.content === undefined) {
            try { full = { ...article, ...(await StorageManager.getArticleFull(article.id)) }; } catch (_) { /* send what we have */ }
        }
        let enabledNow = false;
        if (!(await mgr.status()).toPhone) {
            const on = await mgr.enableToPhone();
            if (!on.ok) { toast(T('Could not switch on Send to phone: {message}', { message: phoneErrorText(on.error) })); return; }
            enabledNow = true;
        }
        toast(T('Sending to your phone…'));
        const parse = (html) => new DOMParser().parseFromString(html, 'text/html').body;
        let marks = [];
        try { marks = await fetchAnnotationsForArticle(full); } catch (_) { /* send without highlights */ }
        const r = await mgr.sendArticle(articleForPhone(full, parse, marks));
        if (!r.ok) { toast(T('Could not send to your phone: {message}', { message: phoneErrorText(r.error) })); return; }
        if (enabledNow) {
            toast(T('Sent. To receive it, scan the new code in the phone app once (Settings → Phone inbox).'));
            if (hist.ui) hist.ui.showScreen('settings');
            openPanel();
        } else {
            toast(r.truncated ? T('Sent to your phone (long article shortened). It arrives within about 15 minutes.') : T('Sent to your phone. It arrives within about 15 minutes.'));
        }
        if (article.id) applyStatus([article.id], { sent: { kind: 'phone', label: '' } }).catch(() => {});
    } catch (err) {
        console.error('[Send to phone]', err);
        toast(T('Could not send to your phone: {message}', { message: err?.message || '' }));
    }
}

function phoneErrorText(code) {
    switch (code) {
        case 'too-large': return T('this article is too large');
        case 'rate-limited': return T('too many sends, try again later');
        case 'inbox-full': return T('the phone has not collected the earlier articles yet');
        case 'pairing-invalid': return T('the pairing is no longer valid, pair again');
        case 'unreachable': return T('the server is not reachable');
        case 'unreadable': return T('the article could not be prepared');
        default: return T('unknown error');
    }
}

/**
 * Non-interactive deliveries used by the History multi-select sheet (sendSheet.js).
 * They return {ok, error?} instead of toasting, so the sheet can show progress per item.
 */
export async function deliverKindle(article, device) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) return { ok: false, error: T('No Kindle email set.') };
    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) headers['Authorization'] = `Bearer ${config[SK.token]}`;
        else if (config[SK.licenseKey]) headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        const annotations = article.id ? await fetchAnnotationsForArticle(article) : [];
        const annotationsHtml = article.id ? await buildAnnotationsSection(article, annotations) : '';
        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST', headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                format: normalizeKindleFormat(config.kindleFormat),
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });
        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.success) return { ok: true };
        return { ok: false, error: resData.error || T('Kindle delivery failed.') };
    } catch (err) {
        return { ok: false, error: err?.message || T('Network error') };
    }
}

export async function deliverLocalSend(article, device) {
    const ip = (device?.addresses?.[0] || '').trim();
    if (!ip) return { ok: false, error: T('No receiver address set.') };
    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);
        await sendToLocalSend(ip, fileName, docHtml, 'text/html');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || T('Check if the receiver is online.') };
    }
}

/** Bulk: one Markdown file with every selected summary (separated by a rule). */
export async function exportManyMarkdown(list) {
    const parts = [];
    for (const a of list) { try { parts.push((await buildMarkdown(a)).mdContent); } catch (_) { /* skip unreadable */ } }
    if (!parts.length) return false;
    downloadBlob(new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown' }), `AISH-${new Date().toISOString().slice(0, 10)}-${parts.length}.md`);
    return true;
}
