// history/detail.js — the article detail view: title edit, source card, Q&A, tags, citation, the action toolbar and its
// editor. Loaded the first time an article is opened (articleManager.js re-exports showArticleDetail / openArticleInHistory).
import { mountReadingTools } from '../readingTools.js';
import { modelIcon } from '../modelBadge.js';
import { icon, iconEl } from '../icons.js';
import { TOOLBAR_CATALOG, TOOLBAR_PREF, DEFAULT_TOOLBAR, normalizeToolbar } from '../detailToolbar.js';
import { SK } from '../storageKeys.js';
import { escapeHtml, cleanUntrustedHtml } from '../textUtils.js';
import StorageManager from '../storageManager.js';
import { attachCardMenu } from '../cardMenu.js';
import { T, locale, uiLocale } from '../feedI18n.js';
import { topicLabel } from '../topicConcepts.js';
import { qaSection } from '../qaView.js';
import { normalizeDoi } from '../../content/paper.js';
import { paperState, paperChips, paperDoi, doiUrl, paperFacts, extractPaperFacts } from '../paperInfo.js';
import { aiComplete } from '../feedAi.js';
import { createInboxManager } from '../inboxManager.js';
import { CITE_STYLES, formatCitation, ensureCsl, copyText, getCiteStyle, loadCiteStyle, setCiteStyle } from '../citation.js';
import { bp } from '../breakpoints.js';
import { hist } from './state.js';
import { lbl, applyStatus, invalidateSearchIndex, recordArticleOpened, wsActive, paintDetailStar, addToCollection, playEnter, renderLocalInsights, shareArticle, exportToMarkdown, exportToPdf, sendToObsidian, copyArticleToClipboard, sendToKindle, dispatchToLocalSend, sendToPhone, includeAllQuestions, exportView } from '../articleManager.js';

const escAttr = escapeHtml;

/** Pencil next to the title in the article detail: rename the saved article (Enter or leaving the field saves, Esc cancels). */
function mountTitleEdit(article, h3) {
    if (!h3 || !article || !article.id) return;
    const pen = document.createElement('button');
    pen.type = 'button'; pen.className = 'detail-title-edit';
    pen.append(iconEl('pencil', 'icon--sm'));
    pen.title = T('Rename'); pen.setAttribute('aria-label', T('Rename'));
    h3.appendChild(pen);
    pen.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'detail-title-input'; input.maxLength = 200; input.value = article.title || '';
        input.setAttribute('aria-label', T('Title'));
        // The title is plain text inside the h3 (escaped HTML); rebuild it as one text node to be safe.
        const setText = (title) => { [...h3.childNodes].forEach(n => { if (n !== pen && !(n.nodeType === 1 && n.classList.contains('detail-fav'))) n.remove(); }); h3.insertBefore(document.createTextNode(title), pen); };
        const original = article.title || '';
        [...h3.childNodes].forEach(n => { if (n !== pen && !(n.nodeType === 1 && n.classList.contains('detail-fav'))) n.remove(); });
        pen.hidden = true; h3.insertBefore(input, pen); input.focus(); input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return; done = true;
            const next = input.value.replace(/\s+/g, ' ').trim();
            input.remove(); pen.hidden = false;
            if (save && next && next !== original) {
                const stored = await StorageManager.setTitle(article.id, next);
                if (stored) {
                    article.title = stored;
                    [hist.cached, hist.archived].forEach(list => { const hit = list.find(a => a.id === article.id); if (hit) hit.title = stored; });
                    invalidateSearchIndex();
                    setText(stored);
                    if (hist.ui) hist.ui.showToast(T('Renamed'));
                    return;
                }
            }
            setText(original);
        };
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
        input.addEventListener('blur', () => finish(true));
    });
}

/** Inline in the article: which collections hold it. (The source check lives in the source card under the tags.) */
async function mountSourceCheck(article, host) {
    if (!host || !article || !article.id) return;
    try {
        const [{ collectionsStrip }, full] = await Promise.all([import('../collectionsView.js'), StorageManager.getArticleFull(article.id)]);
        if (!host.isConnected) return;
        host.textContent = '';
        host.append(await collectionsStrip(full));
    } catch (_) { /* the article still reads fine without it */ }
}

/**
 * Shows the full article detail view with back button
 */
/** Pinned follow-ups inline, the rest collapsed; pin changes and the export switch are saved right away. */
async function renderDetailQa(article, mount) {
    if (!mount) return;
    const turns = Array.isArray(article.conversation) ? article.conversation : [];
    const draw = async () => {
        mount.replaceChildren(qaSection(turns, {
            includeAll: await includeAllQuestions(),
            onPin: async () => {
                await StorageManager.saveConversation(article.id, turns);
                draw();
            },
            onIncludeAll: (v) => StorageManager.setLocal({ [SK.exportAllQuestions]: !!v }),
            onSource: (quote, chip) => { chip.classList.toggle('chat-src--open'); chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote); }
        }));
    };
    draw();
}

/** 🎓 row in the detail view: badges, authors · journal · year, DOI link and the "Mark as paper / Not a paper" override. */
/** Stores a DOI on the article (and marks it as a paper); also fills the source profile from doi.org once. Callers refresh the view. */
async function assignDoiTo(article, doi) {
    await StorageManager.savePaperInfo(article.id, { state: 'yes', doi });
    await applyStatus([article.id], { paperOverride: 'yes' });
    article.paperOverride = 'yes'; article.doi = doi; article.paper = 'yes';
    article.meta = Object.assign({}, article.meta, { paper: Object.assign({}, article.meta && article.meta.paper, { state: 'yes', doi }) });
    const hit = hist.cached.find(a => a.id === article.id) || hist.archived.find(a => a.id === article.id);
    if (hit) { hit.doi = doi; hit.paper = 'yes'; }
    try {   // the profile (title, authors, year, publisher) from the DOI, so the card shows it right away
        const CV = await import('../collectionsView.js');
        const full = await StorageManager.getArticleFull(article.id);
        await CV.autoFillFromDoi({ ...article, ...full });
    } catch (_) { /* the DOI is saved either way */ }
}

/** Tag row of the detail view (status badges only exist on list cards, where they come before the type): 🎓 paper chips first (✕ = not a paper), then the tags (✕ removes), then "+ Tag" (also: mark as research paper). */
function renderDetailTags(article, host) {
    if (!host) return;
    host.replaceChildren();
    const mk = (cls, text) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; return c; };
    const xBtn = (label, onClick) => {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'tag-x'; x.append(iconEl('x', 'icon--sm')); x.title = label; x.setAttribute('aria-label', label);
        x.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return x;
    };
    const refresh = () => { renderDetailTags(article, host); renderPaperRow(article, host.parentNode && host.parentNode.querySelector('.paper-row')); };
    paperChips(article).forEach(([tone, text], i) => {
        const c = mk('tag-chip paper paper-' + tone, text);
        if (i === 0) c.appendChild(xBtn(T('Not a paper'), async () => { await applyStatus([article.id], { paperOverride: 'no' }); article.paperOverride = 'no'; refresh(); }));
        host.appendChild(c);
    });
    const saveTags = async (next) => {
        const stored = await StorageManager.setTags(article.id, next);
        if (!stored) return;
        article.tags = stored;
        const hit = hist.cached.find(a => a.id === article.id) || hist.archived.find(a => a.id === article.id);
        if (hit) hit.tags = stored;
        refresh();
    };
    (article.tags || []).forEach((t) => {
        const shown = topicLabel(t, uiLocale());
        const c = mk('tag-chip', shown);
        if (shown !== t) c.title = t;   // the stored (original) spelling
        if (article.id) c.appendChild(xBtn(T('Remove tag'), () => saveTags((article.tags || []).filter(x => x !== t))));
        host.appendChild(c);
    });
    if (!article.id) return;
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'tag-chip tag-add'; add.textContent = T('+ Tag / DOI');
    add.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'tag-input'; input.maxLength = 200; input.placeholder = T('Add tag or DOI…'); input.setAttribute('aria-label', T('Add tag or DOI…'));
        const assignDoi = async (doi) => { await assignDoiTo(article, doi); refresh(); };
        const commit = () => {
            const v = input.value.trim();
            const doi = v ? normalizeDoi(v) : '';
            if (doi && /^(?:https?:\/\/\S*doi\.org\/|doi:\s*)?10\./i.test(v)) assignDoi(doi);   // a pasted DOI / doi.org link is assigned to the paper, not saved as a tag
            else if (v) saveTags([...(article.tags || []), v]); else refresh();
        };
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.stopPropagation(); refresh(); } });
        input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) commit(); }, 120));
        add.replaceWith(input);
        // Suggestions: 🎓 Research paper (unless already one), then the tags already known (most used first, archive included; plus the tags
        // the sync places and the MCP server filter on, e.g. "private"), then the built-in categories.
        const have = new Set((article.tags || []).map(t => t.toLowerCase()));
        const freq = new Map();
        [...(hist.cached || []), ...(hist.archived || [])].forEach(a => (a.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
        const cats = [T('News'), T('Tutorial'), T('Opinion'), T('Reference'), T('Interview')];
        const sugg = [];
        const nameBtns = [];
        const mkSugg = (label, onPick, isPaper) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'tag-chip tag-add tag-suggest' + (isPaper ? ' tag-suggest-paper' : ''); b.textContent = label;
            b.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep the input's blur from swallowing the click
            b.addEventListener('click', onPick);
            sugg.push(b); return b;
        };
        let anchor = input;
        if (!paperState(article)) anchor = (() => { const b = mkSugg(T('🎓 Research paper'), async () => { await applyStatus([article.id], { paperOverride: 'yes' }); article.paperOverride = 'yes'; refresh(); }, true); input.after(b); return b; })();
        const fillNames = (extra) => {
            nameBtns.forEach(b => { sugg.splice(sugg.indexOf(b), 1); b.remove(); });
            nameBtns.length = 0;
            const used = [...freq.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
            const names = [...new Set([...extra, ...used, ...cats].filter(t => t && !have.has(t.toLowerCase())))].slice(0, 16);
            const btns = names.map(n => mkSugg(n, () => saveTags([...(article.tags || []), n])));
            nameBtns.push(...btns);
            anchor.after(...btns);
            if (input.value && typeof Event === 'function') input.dispatchEvent(new Event('input'));   // keep the typed filter applied
        };
        fillNames([]);
        StorageManager.getLocal({ [SK.syncPlaces]: [] }).then((r) => {
            if (!input.isConnected) return;
            const extra = [];
            (r[SK.syncPlaces] || []).forEach(pl => { const f = (pl && pl.filter) || {}; if (f.tag) extra.push(f.tag); if (f.excludeTag) extra.push(f.excludeTag); });
            if (extra.length) fillNames(extra);
        }).catch(() => {});
        const doiSugg = mkSugg('', () => { const d = normalizeDoi(input.value); if (d) assignDoi(d); }, true);
        doiSugg.hidden = true;
        input.after(doiSugg);
        input.addEventListener('input', () => {
            const dv = /^(?:https?:\/\/\S*doi\.org\/|doi:\s*)?10\./i.test(input.value.trim()) ? normalizeDoi(input.value) : '';
            doiSugg.hidden = !dv; if (dv) doiSugg.textContent = T('🎓 Assign DOI {doi}', { doi: dv });
            const q = input.value.trim().toLowerCase();
            sugg.forEach(b => { if (b === doiSugg) return; b.hidden = !!q && !b.textContent.toLowerCase().includes(q) && !b.classList.contains('tag-suggest-paper'); });
        });
        input.focus();
    });
    host.appendChild(add);
}

function renderCiteBlock(article, host) {
    host.replaceChildren();
    const doi = paperDoi(article);
    const csl = article.meta && article.meta.paper && article.meta.paper.csl;
    const head = () => host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-head', textContent: T('❝ Cite') }));
    if (!doi || !doiUrl(doi)) { head(); host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-note', textContent: T('Citation unavailable — no DOI found') })); return; }
    if (!csl) {
        head();
        host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-note', textContent: T('Looks the citation up at doi.org. Only the DOI is sent.') }));
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'button-secondary'; b.textContent = T('Get citation');
        b.addEventListener('click', async (e) => {
            e.stopPropagation(); b.disabled = true; b.textContent = T('Looking up…');
            try {
                const got = await ensureCsl(article, doi);
                article.meta = { ...(article.meta || {}), paper: { ...((article.meta || {}).paper || {}), csl: got } };
                renderCiteBlock(article, host);
            } catch (_) { b.disabled = false; b.textContent = T('Citation lookup failed — try again'); }
        });
        host.appendChild(b);
        return;
    }
    const text = formatCitation(csl, getCiteStyle());
    // Header row (like the Figma "Cite" panel): style dropdown left, Copy + DOI right; the citation text sits below.
    const bar = document.createElement('div'); bar.className = 'cite-actions';
    const sel = document.createElement('select'); sel.className = 'cite-style'; sel.setAttribute('aria-label', T('❝ Cite'));
    CITE_STYLES.forEach(([id, label]) => { const o = document.createElement('option'); o.value = id; o.textContent = label; if (id === getCiteStyle()) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => { e.stopPropagation(); setCiteStyle(sel.value); renderCiteBlock(article, host); });
    const sp = document.createElement('span'); sp.className = 'cite-spacer';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'cite-btn cite-copy'; copy.textContent = '⧉ ' + T('Copy');
    copy.addEventListener('click', async (e) => { e.stopPropagation(); if (await copyText(text) && hist.ui) hist.ui.showToast(T('Copied to clipboard! 📋')); });
    const open = document.createElement('a'); open.className = 'cite-btn cite-open'; open.href = doiUrl(doi); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = T('DOI ↗'); open.title = T('Open DOI ↗');
    bar.append(sel, sp, copy, open);
    const box = document.createElement('pre'); box.className = 'cite-text'; box.textContent = text;
    host.append(bar, box, Object.assign(document.createElement('div'), { className: 'cite-src', textContent: T('Source: doi.org') }));
}

// ── Source card (Paper details + Source check in one) ─────────────────────
// One card under the tags: a summary that is always visible (type, hints, authors · year · publisher, DOI — or a field to add one)
// and up to three sections, collapsed by default (Key facts opens when a DOI is set): Key facts and Cite (papers), Source check (every saved article).
// Wide pane: facts + cite on the left, the check on the right (CSS container query).
let sourceOpen = {};
const yearOf = (d) => String(d || '').slice(0, 4);

async function paintSourceSummary(article, box, row) {
    try {
        const [C, CV, full] = await Promise.all([import('../collections.js'), import('../collectionsView.js'), StorageManager.getArticleFull(article.id)]);
        if (!box.isConnected) return;
        const rec = { ...article, ...full };
        const profile = C.effectiveProfile(rec);
        const hints = C.profileHints(profile);
        box.replaceChildren();
        const l1 = document.createElement('div'); l1.className = 'source-line1';
        const ty = document.createElement('strong'); ty.className = 'source-type';
        ty.textContent = (paperState(article) ? '🎓 ' : '🔎 ') + (CV.typeLabel(profile.type) || T('Source'));
        l1.append(ty);
        if (hints.includes('preprint')) { const h = document.createElement('span'); h.className = 'source-hint'; h.textContent = CV.hintLabel('preprint'); l1.append(h); }
        const sp = document.createElement('span'); sp.className = 'source-sp'; l1.append(sp);
        const doi = paperDoi(rec);
        if (doi && doiUrl(doi)) {
            const a = document.createElement('a'); a.className = 'cite-btn source-doi'; a.href = doiUrl(doi); a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.textContent = (rec.sourceProfile && rec.sourceProfile.fromDoi ? T('DOI ✓ ↗') : T('DOI ↗')); a.title = doi;
            l1.append(a);
        } else {
            const add = document.createElement('button'); add.type = 'button'; add.className = 'cite-btn source-doi-add'; add.textContent = T('+ DOI');
            add.addEventListener('click', (e) => {
                e.stopPropagation();
                const input = document.createElement('input'); input.type = 'text'; input.className = 'tag-input source-doi-input'; input.maxLength = 200;
                input.placeholder = T('10.xxxx/… or doi.org link'); input.setAttribute('aria-label', T('Add DOI'));
                let done = false;
                const commit = async () => {
                    if (done) return; done = true;
                    const v = input.value.trim(); const d = v ? normalizeDoi(v) : '';
                    if (d && doiUrl(d)) {
                        input.disabled = true;
                        await assignDoiTo(article, d);
                        const tags = row.parentNode && row.parentNode.querySelector('.detail-tags');
                        if (tags) renderDetailTags(article, tags); else renderPaperRow(article, row);
                    } else { if (v && hist.ui) hist.ui.showToast(T('Enter a valid DOI first.')); paintSourceSummary(article, box, row); }
                };
                input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { done = true; paintSourceSummary(article, box, row); } });
                input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) commit(); }, 120));
                add.replaceWith(input); input.focus();
            });
            l1.append(add);
        }
        const line = [profile.author, yearOf(profile.date), profile.publisher].filter(Boolean).join(' · ');
        const l2 = document.createElement('div'); l2.className = 'source-line2' + (line ? '' : ' is-empty'); l2.textContent = line || T('No source details yet');
        box.append(l1, l2);
        // check progress in the (closed) section header
        const pr = C.checkProgress(rec.sourceCheck);
        paintCheckProgress(row, pr);
        // a DOI is known but the profile was never filled from it: do it once, then show the result
        if (doi) CV.autoFillFromDoi(rec).then((p) => { if (p && box.isConnected) paintSourceSummary(article, box, row); });
    } catch (_) { /* the card still works without its summary */ }
}

function paintCheckProgress(row, pr) {
    const t = row && row.querySelector('.source-progress'); if (!t) return;
    t.textContent = T('{a} of {n} answered', { a: pr.answered, n: pr.total });
    t.classList.toggle('is-done', !!pr.done);
    const dots = row.querySelector('.source-dots');
    if (dots) { dots.replaceChildren(); for (let i = 0; i < pr.total; i++) { const d = document.createElement('i'); if (i < pr.answered) d.className = 'on'; dots.append(d); } }
}

function renderPaperRow(article, row) {
    if (!row) return;
    row.replaceChildren();
    if (!article || !article.id || article.feedStub) { row.hidden = true; return; }
    row.hidden = false;
    row.className = 'paper-row source-card-row';
    const isPaper = !!paperState(article);
    const card = document.createElement('div'); card.className = 'source-card' + (isPaper ? '' : ' no-paper');
    const summary = document.createElement('div'); summary.className = 'source-summary';
    card.append(summary);
    const section = (key, title, extra) => {
        const d = document.createElement('details'); d.className = 'source-sec source-sec-' + key;
        d.open = key in sourceOpen ? !!sourceOpen[key] : (key === 'facts' && !!paperDoi(article));   // with a DOI the key facts are open by default; a manual choice wins
        d.addEventListener('toggle', () => { sourceOpen[key] = d.open; });
        const sm = document.createElement('summary'); const t = document.createElement('span'); t.className = 'source-sec-t'; t.textContent = title; sm.append(t);
        if (extra) sm.append(extra);
        d.append(sm); card.append(d); return d;
    };
    if (isPaper) {
        // key facts
        const facts = paperFacts(article);
        const fs = section('facts', T('Key facts'));
        const body = document.createElement('div'); body.className = 'source-sec-body'; fs.append(body);
        if (facts.length) {
            const box = document.createElement('dl'); box.className = 'paper-facts';
            facts.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; box.append(dt, dd); });
            body.append(box);
        } else {
            const f = document.createElement('button');
            f.type = 'button'; f.className = 'button-secondary paper-facts-btn'; f.textContent = T('🔎 Key facts');
            f.addEventListener('click', async (e) => {
                e.stopPropagation();
                f.disabled = true; f.textContent = T('Thinking…');
                try {
                    const merged = await extractPaperFacts(article, aiComplete, new Intl.DisplayNames(['en'], { type: 'language' }).of(locale()) || 'English');
                    article.meta = { ...(article.meta || {}), paper: { ...((article.meta || {}).paper || {}), ...merged } };
                    article.paperType = merged.type;
                    sourceOpen.facts = true;
                    renderPaperRow(article, row);
                } catch (err) { f.disabled = false; f.textContent = '❌ ' + ((err && err.message) || T('AI request failed')); }
            });
            body.append(f);
        }
        // cite
        const cs = section('cite', T('Cite'));
        const cite = document.createElement('div'); cite.className = 'cite-block source-sec-body'; cs.append(cite); renderCiteBlock(article, cite);
    }
    // source check: built when first opened (it reads the saved profile and answers)
    const progress = document.createElement('span'); progress.className = 'source-progress';
    const dots = document.createElement('span'); dots.className = 'source-dots'; dots.setAttribute('aria-hidden', 'true');
    const extra = document.createElement('span'); extra.className = 'source-sec-x'; extra.append(progress, dots);
    const ck = section('check', T('Source check'), extra);
    const checkBody = document.createElement('div'); checkBody.className = 'source-sec-body'; ck.append(checkBody);
    const buildCheck = async () => {
        if (checkBody.firstChild) return;
        try {
            const [CV, full] = await Promise.all([import('../collectionsView.js'), StorageManager.getArticleFull(article.id)]);
            const panel = CV.sourceCheckPanel({ ...article, ...full }, {
                origin: 'inline', bare: true,
                onChange: () => { paintCheckProgress(row, panel.getProgress()); paintSourceSummary(article, summary, row); },
            });
            checkBody.append(panel);
        } catch (_) { /* the rest of the card still works */ }
    };
    ck.addEventListener('toggle', () => { if (ck.open) buildCheck(); });
    if (ck.open) buildCheck();
    row.appendChild(card);
    paintSourceSummary(article, summary, row);
}

/** Open an article from outside History (summary bubble, feed, graph): switch to History and show it at once, without waiting for the list. */
export function openArticleInHistory(article) {
    if (hist.ui && typeof hist.ui.showScreen === 'function') hist.ui.showScreen('history');
    return showArticleDetail(article);
}

export async function showArticleDetail(article) {
    hist.detailChosenAt = Date.now();
    const needsLoad = !!(article && article.id && article.content === undefined);
    if (needsLoad) showDetailSkeleton();
    // List/graph/search cards only carry the lean articlesIndex shape (no
    // content) — load the full article:<id> record before rendering detail.
    // Callers that already pass a full in-memory article (e.g. mainScreen.js
    // right after a save) have `content` set and skip this fetch.
    // The cite style and toolbar prefs are needed before the first paint too: read them alongside, not one after another.
    const prefs = Promise.all([loadCiteStyle(), loadToolbarPrefs()]);
    if (needsLoad) {
        try {
            const full = await StorageManager.getArticleFull(article.id);
            article = { ...article, ...full };
        } catch (err) {
            console.error('[AISH] Failed to load article content:', err);
        }
    }

    if (article && article.id && article.conversation === undefined) {
        try {
            // the full record (read above) already carries the conversation; only a lean article needs its own read
            const conversation = needsLoad ? [] : await StorageManager.getConversation(article.id);
            article = { ...article, conversation };
            // follow-ups saved before they were appended to the summary: do it now (once)
            if (conversation.length && article.summaryBase === undefined && await StorageManager.saveConversation(article.id, conversation)) {
                article.summaryBase = article.summary;
            }
        } catch (_) { article = { ...article, conversation: [] }; }
    }
    await prefs;
    hist.detail = article;
    sourceOpen = {};   // the source card starts collapsed on every article
    {   const ds = document.getElementById('detailStarBtn'); if (ds) { ds.hidden = !article.id || !!article.feedStub; paintDetailStar(!!article.favorite); } }
    recordArticleOpened(article);
    if (article && article.id && !article.readAt && !article.feedStub) { article.readAt = new Date().toISOString(); applyStatus([article.id], { read: true }).catch(() => {}); }
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const articleDetailContent = document.getElementById('articleDetailContent');
    const graphContainer = document.getElementById('graphContainer');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');

    if (!articleDetail || !articleDetailContent) return;

    // Choose the highest fidelity data field available instantly
    const rawContentSource = article.content || article.html || article.text || '';

    const safeTitle = escapeHtml(article.title || (rawContentSource && rawContentSource.split('\n')[0]) || T('Article'));
    // Saved summary and page HTML come from arbitrary pages (and restored backups): parse inert, then clean.
    const fallbackSummary = article.savedOnly
        ? '<p><em>' + escapeHtml(T('Saved without an AI summary. Open the page and tap ✨ Summarize to add one.')) + '</em></p>'
        : escapeHtml(T('No summary available'));
    const summaryDoc = new DOMParser().parseFromString(article.summaryBase !== undefined ? article.summaryBase : (article.summary || fallbackSummary), 'text/html');
    summaryDoc.querySelectorAll('img').forEach(el => el.remove());
    const safeSummary = cleanUntrustedHtml(summaryDoc.body).innerHTML;

    const detailDoc = new DOMParser().parseFromString(rawContentSource, 'text/html');
    cleanUntrustedHtml(detailDoc.body);
    // Keep the images; .detail-original img caps their width so they don't break the popup layout
    const safeContent = detailDoc.body.innerHTML || escapeHtml(T('No content available.'));
    const domain = article.url ? (() => { try { return new URL(article.url).hostname; } catch { return ''; } })() : '';
    const modelInfo = article.modelId ? `<span class="detail-model">${modelIcon(article)} ${escapeHtml(article.modelId)}</span>` : '';
    const lengthInfo = article.summaryLength ? `<span class="detail-length">📏 ${escapeHtml(article.summaryLength)}w</span>` : '';
    
    // Decision metadata
    const decisionBadge = article.isDecision ? `
      <div class="detail-decision">
        <div class="detail-decision-head">
          <span aria-hidden="true">🔖</span>
          <span class="detail-decision-title">${T('Saved for Later')}</span>
          ${article.decisionTimeframe ? `<span class="decision-chip">${escapeHtml(article.decisionTimeframe)}</span>` : ''}
        </div>
        ${article.decisionReason ? `<p class="detail-decision-reason">${escapeHtml(article.decisionReason)}</p>` : ''}
      </div>
    ` : '';

    articleDetailContent.removeAttribute('aria-busy');
    // eslint-disable-next-line no-unsanitized/property -- reviewed: safeSummary/safeContent went through cleanUntrustedHtml, labels through lbl() (escapeHtml)
    articleDetailContent.innerHTML = `
      <div class="article-detail-card">
        <h3 class="detail-title"><img class="detail-fav" alt="" hidden>${safeTitle}</h3>
        <p class="detail-desc" hidden></p>
        <p class="detail-meta">
          ${article.url ? `<a href="${escAttr(article.url)}" target="_blank" rel="noopener">${escapeHtml(domain)} ↗</a> · ` : ''}
          ${new Date(article.timestamp).toLocaleDateString()}${(modelInfo || lengthInfo) ? ' · ' : ''}${modelInfo}${lengthInfo}
        </p>
        <div class="detail-tags"></div>
        ${decisionBadge}
        <div class="paper-row" hidden></div>
        <div class="action-bar detail-actions">
          <button class="button-secondary open-button">${icon('book-open')} <span class="act-label">${lbl('Read 👓')}</span></button>
          <button class="button-secondary copy-button">${icon('copy')} <span class="act-label">${lbl('Copy 📋')}</span></button>
          <button class="button-secondary share-button">${icon('link')} <span class="act-label">${lbl('Share 🔗')}</span></button>
          <button class="button-secondary kindle-button">${icon('book-open')} <span class="act-label">${lbl('Kindle 📚')}</span></button>
          <button class="button-secondary localsend-button">${icon('smartphone')} <span class="act-label">${lbl('LocalSend 📱')}</span></button>
        </div>
        <div class="summary-box">
          <strong class="summary-box-title">${T('🧙 AI Summary')}</strong>
          <div>${safeSummary}</div>
          <div id="qaMount" class="detail-qa"></div>
        </div>
        <div id="sourceCheckMount" class="detail-source"></div>
        <section id="articleNotesMount" class="detail-notes" aria-label="${escAttr(T('Notes and highlights'))}"></section>
        <div id="localInsights" class="detail-insights"></div>
        <details class="detail-original">
          <summary>${T('📄 Original Content')}</summary>
          <div class="detail-original-body">${safeContent}</div>
        </details>
      </div>
    `;

    // On-device insights (reading level, sentiment, similar articles) load
    // asynchronously and progressively fill in — they never block the rest
    // of the detail view from rendering.
    renderLocalInsights(article, articleDetailContent.querySelector('#localInsights'));
    renderDetailTags(article, articleDetailContent.querySelector('.detail-tags'));
    mountTitleEdit(article, articleDetailContent.querySelector('.detail-title'));
    renderPaperRow(article, articleDetailContent.querySelector('.paper-row'));
    renderDetailQa(article, articleDetailContent.querySelector('#qaMount'));
    mountSourceCheck(article, articleDetailContent.querySelector('#sourceCheckMount'));
    import('../notesView.js').then((m) => { const host = articleDetailContent.querySelector('#articleNotesMount'); if (host && article.id) m.mountArticleNotes(host, article); }).catch(() => { /* notes are optional here */ });
    {   // saved page metadata: favicon + description (set as text, never as HTML)
        const m = article.meta || {};
        const fav = m.favicon || article.favicon;
        const img = articleDetailContent.querySelector('.detail-fav');
        if (img && fav && /^https?:|^data:/.test(fav)) { img.src = fav; img.hidden = false; img.addEventListener('error', () => { img.hidden = true; }); }
        const desc = articleDetailContent.querySelector('.detail-desc');
        const text = m.description || article.description || '';
        if (desc && text) { desc.textContent = text; desc.hidden = false; }
    }

    // Wire up buttons
    const shareBtn = articleDetailContent.querySelector('.share-button');
    const copyBtn = articleDetailContent.querySelector('.copy-button');
    const kindleBtn = articleDetailContent.querySelector('.kindle-button');
    const localSendBtn = articleDetailContent.querySelector('.localsend-button');
    const openBtn = articleDetailContent.querySelector('.open-button');

    StorageManager.getAll().then((cfg) => {
        const pref = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
        if (kindleBtn) kindleBtn.style.display = pref === 'kindle' ? 'inline-flex' : 'none';
        if (localSendBtn) localSendBtn.style.display = pref === 'localsend' ? 'inline-flex' : 'none';
    }).catch(() => {
        // Fallback: show Kindle if settings retrieval fails.
        if (kindleBtn) kindleBtn.style.display = 'inline-flex';
        if (localSendBtn) localSendBtn.style.display = 'none';
    });

    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareArticle(article); });
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyArticleToClipboard(article); });
    if (kindleBtn) kindleBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToKindle(article); });
    if (localSendBtn) localSendBtn.addEventListener('click', (e) => { e.stopPropagation(); dispatchToLocalSend(article); });
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openReadMode(article);
        });
    }
    {   // ⋯ — everything the list's menu offers (Markdown, ODT/Word/PDF, Obsidian, archive, delete, …)
        const bar = articleDetailContent.querySelector('.detail-actions');
        if (bar) attachCardMenu(bar, article, { detail: true, extra: detailExtraItems, onRemoved: () => { const b = document.getElementById('detailBackButton'); if (b) b.click(); } });
    }
    // Show detail, hide list and graph
    // fresh content: drop the previous article's buttons from the top bar (they were moved out of the old content),
    // otherwise every opened article would add another set of Read/Copy/Share/Kindle buttons
    hist.toolbarEditing = false; document.getElementById('toolbarTray')?.remove();
    parkExistingTools();
    document.getElementById('detailTopActions')?.remove();
    detailTopBar?.querySelectorAll('.card-menu-btn').forEach(b => b.remove());
    topActions = false;   // buttons are in the row again until the layout runs below
    if (articleList) articleList.style.display = 'none';
    if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    const wasShown = articleDetail.style.display === 'block';
    articleDetail.style.display = 'block';
    if (!wasShown) playEnter(articleDetail);   // the skeleton already showed it for a lean article: no second entrance
    layoutDetailActions();
    mountReadingTools({ scroller: document.getElementById('historyScreen'), content: articleDetailContent, article });   // Scroll to top + contents on long texts
    // Keyboard: focus moves to "Back" (so Esc / Enter returns); the card that opened this stays remembered.
    const back = document.getElementById('detailBackButton');
    if (back) back.focus({ preventScroll: true });
}


// ── Detail actions: one joined toolbar in the top bar when there is room ──
// Wide enough: a single segmented bar next to Back — Read / Copy / Share first, more of the user's configured actions as the
// pane gets wider, ⋯ as its last segment (it always carries everything). Narrow (the popup): the buttons stay in the row below
// the title, as before.
let topActions = false;
let toolbarPrefs = { items: DEFAULT_TOOLBAR.slice(), delivery: 'kindle', sendTarget: 'kindle' };
const loadToolbarPrefs = () => StorageManager.getAll().then((cfg) => {
    const delivery = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
    toolbarPrefs = { items: normalizeToolbar(cfg[TOOLBAR_PREF]), delivery, sendTarget: SEND_TARGETS[cfg.lastSendTarget] ? cfg.lastSendTarget : delivery };
}).catch(() => {});
const toolbarShown = new Set();   // ids currently in the bar (the rest is reachable through ⋯)
const detailExtraItems = () => !topActions ? [] : [
    ...(toolbarShown.has('favorite') || !document.getElementById('detailStarBtn') || document.getElementById('detailStarBtn').hidden ? [] : [{ icon: 'star', label: hist.detail && hist.detail.favorite ? T('Remove from favorites') : T('Favorite'), run: () => document.getElementById('detailStarBtn').click() }]),
    { icon: 'settings', label: T('Customize toolbar…'), run: () => enterToolbarEdit(), sep: true },
    { icon: 'network', label: T('View graph'), run: () => document.getElementById('detailGraphToggleBtn')?.click() },
    { icon: 'chart-column', label: T('View analytics report'), run: () => document.getElementById('detailReportToggleBtn')?.click() },
];
const toolbarRun = (id, a) => ({
    read: () => openReadMode(a), copy: () => copyArticleToClipboard(a),
    markdown: () => exportToMarkdown(a), obsidian: () => sendToObsidian(a),
    pdf: () => exportToPdf(a), collection: () => addToCollection(a),
}[id]);
// Send split button: where "Send" goes. The label shows the last used target; the ▾ lists them all.
const SEND_TARGETS = {
    kindle: { icon: 'book-open', short: () => T('Kindle'), label: () => T('Send to Kindle'), run: (a) => sendToKindle(a) },
    localsend: { icon: 'share-2', short: () => T('LocalSend'), label: () => T('Send via LocalSend'), run: (a) => dispatchToLocalSend(a) },
    phone: { icon: 'smartphone', short: () => T('Phone'), label: () => T('Send to phone'), run: (a) => sendToPhone(a) },
    share: { icon: 'send', short: () => T('Share'), label: () => T('Share…'), run: (a) => shareArticle(a) },
};
const sendTargetOk = (id, a) => id !== 'phone' || !!(a && a.id && a.url && !a.feedStub);
const SEND_UNDO_SECONDS = 10;
const pendingSends = new Set();
/** Holds a send back for a few seconds so it can still be taken back. Leaving the popup sends it right away (nothing is lost). */
function sendWithUndo(label, run) {
    if (!hist.ui) return run();
    let left = SEND_UNDO_SECONDS, done = false, tick = null, toast = null;
    const text = () => T('Sending to {name} in {n} s', { name: label, n: left });
    const finish = (go) => { if (done) return; done = true; clearInterval(tick); pendingSends.delete(flush); if (toast) toast.dismiss(); if (go) return run(); hist.ui.showToast(T('Cancelled: not sent')); };
    const flush = () => finish(true);
    toast = hist.ui.showToast(text(), (SEND_UNDO_SECONDS + 1) * 1000, { label: T('Undo'), onClick: () => finish(false) });
    pendingSends.add(flush);
    tick = setInterval(() => { left -= 1; if (left <= 0) flush(); else if (toast) toast.setText(text()); }, 1000);
}
try { window.addEventListener('pagehide', () => { [...pendingSends].forEach(f => f()); }); } catch (_) { /* no window */ }
async function runSendTarget(id, a) {
    const def = SEND_TARGETS[id]; if (!def) return;
    toolbarPrefs.sendTarget = id;
    try { chrome.storage.sync.set({ lastSendTarget: id }); } catch (_) { /* remembered for this session only */ }
    layoutDetailActions();
    if (id === 'share') return def.run(a);   // the system share sheet has its own cancel
    let name = def.short();
    try { const cfg = await StorageManager.getAll(); const dev = StorageManager.getActiveDevice(cfg, id); if (dev && dev.label) name = `${def.short()} · ${dev.label}`; } catch (_) { /* generic name */ }
    sendWithUndo(name, () => def.run(a));
}
const SEND_DEVICE_MAX = 3;   // devices shown per send type; the rest sits behind "+N more"
async function openSendMenu(btn, expanded = '') {
    const a = hist.detail; if (!a) return;
    const { openItems } = await import('../cardMenu.js');
    let phone = null, cfg = {};
    try { phone = (await createInboxManager().status()).paired; } catch (_) { /* unknown → plain row */ }
    try { cfg = await StorageManager.getAll(); } catch (_) { /* no devices known → plain rows */ }
    const items = [];
    for (const id of ['kindle', 'localsend', 'phone'].filter(t => sendTargetOk(t, a))) {
        const def = SEND_TARGETS[id];
        const devices = id === 'phone' ? [] : (Array.isArray(cfg[SK.devices]) ? cfg[SK.devices].filter(d => d.type === id) : []);
        const last = id === toolbarPrefs.sendTarget;
        if (!devices.length) {
            items.push({
                icon: def.icon, label: def.label(), active: last,
                sub: last ? T('Last used') : (id === 'phone' && phone === false ? T('Not paired · pair now') : ''),
                tag: id === toolbarPrefs.delivery ? T('Default') : (id === 'phone' && phone ? T('Paired') : ''),
                run: () => runSendTarget(id, a),
            });
            continue;
        }
        const activeId = (StorageManager.getActiveDevice(cfg, id) || {}).id;
        const shown = expanded === id ? devices : devices.slice(0, SEND_DEVICE_MAX);
        for (const d of shown) {
            const isActive = d.id === activeId;
            items.push({
                icon: def.icon, label: `${def.short()} · ${d.label || d.id}`, active: last && isActive,
                sub: last && isActive ? T('Last used') : '',
                tag: id === toolbarPrefs.delivery && isActive ? T('Default') : '',
                run: async () => { try { await StorageManager.setActiveDevice(id, d.id); } catch (_) { /* send to the current device */ } return runSendTarget(id, a); },
            });
        }
        if (devices.length > shown.length) {
            items.push({ icon: 'ellipsis', label: T('{n} more…', { n: devices.length - shown.length }), sub: def.short(), run: () => setTimeout(() => openSendMenu(btn, id), 0) });
        }
    }
    items.push({ icon: 'send', label: T('Share…'), sub: T('System share: apps, AirDrop, mail'), sep: true, run: () => runSendTarget('share', a) });
    items.push({ icon: 'copy', label: T('Copy link'), run: async () => { try { await navigator.clipboard.writeText(a.url || ''); if (hist.ui) hist.ui.showToast(T('Link copied')); } catch (_) { /* ignore */ } } });
    items.push({ icon: 'settings', label: T('Manage targets…'), sep: true, run: () => { if (hist.ui) hist.ui.showScreen('settings'); import('../settingsNav.js').then(m => m.openSettingsPanel('send')).catch(() => {}); } });
    openItems(btn, items);
}
const toolbarAvailable = () => true;
/** How many configured actions fit: at least three, then one more per free slot. */
function toolbarSlots(width, labels, total) {
    const per = labels ? 132 : 50;
    const room = width - 120 /* back */ - 56 /* ⋯ */ - 48 /* gaps */;
    return Math.min(total, Math.max(Math.min(3, total), Math.floor(room / per)));
}
/** Favorite / Read aloud are top-bar buttons with their own state; they move into the toolbar and back. */
function parkExistingTools() {
    const topBar = document.getElementById('detailTopBar'); const more = document.getElementById('detailMoreBtn');
    Object.values(TOOLBAR_CATALOG).forEach((def) => {
        const el = def.existing && document.querySelector(def.existing);
        if (el && topBar) { if (el.parentElement !== topBar) topBar.insertBefore(el, more || null); el.classList.remove('detail-tool'); el.classList.add('tool-parked'); }
    });
}
function paintDetailToolbar(holder, cb, width, labels) {
    const a = hist.detail;
    parkExistingTools();
    holder.replaceChildren(); toolbarShown.clear();
    holder.classList.toggle('with-labels', labels);
    const ids = toolbarPrefs.items.filter(id => TOOLBAR_CATALOG[id] && toolbarAvailable(id, a));
    holder.classList.toggle('is-editing', hist.toolbarEditing);
    ids.slice(0, hist.toolbarEditing ? ids.length : toolbarSlots(width, labels, ids.length)).forEach((id) => {
        const def = TOOLBAR_CATALOG[id];
        const name = def.label();
        if (def.existing) {
            const el = document.querySelector(def.existing); if (!el) return;
            el.classList.add('detail-tool'); el.classList.remove('tool-parked'); toolbarShown.add(id);
            if (!el.querySelector('.act-label')) { const t = document.createElement('span'); t.className = 'act-label'; t.textContent = def.short(); el.append(t); }
            if (hist.toolbarEditing) markEditable(el, id);
            holder.append(el); return;
        }
        if (def.split) {
            const tgt = SEND_TARGETS[sendTargetOk(toolbarPrefs.sendTarget, a) ? toolbarPrefs.sendTarget : 'kindle'];
            const wrap = document.createElement('div'); wrap.className = 'detail-split detail-tool tool-send';
            const main = document.createElement('button'); main.type = 'button'; main.className = 'detail-split-main';
            main.title = tgt.label(); main.setAttribute('aria-label', tgt.label());
            main.append(iconEl(tgt.icon)); const mt = document.createElement('span'); mt.className = 'act-label'; mt.textContent = tgt.short(); main.append(mt);
            main.addEventListener('click', (e) => { e.stopPropagation(); if (!hist.toolbarEditing) runSendTarget(sendTargetOk(toolbarPrefs.sendTarget, a) ? toolbarPrefs.sendTarget : 'kindle', a); });
            const more = document.createElement('button'); more.type = 'button'; more.className = 'detail-split-more'; more.append(iconEl('chevron-down'));
            more.title = T('Send to…'); more.setAttribute('aria-label', T('Send to…')); more.setAttribute('aria-haspopup', 'menu');
            more.setAttribute('aria-expanded', 'false');
            more.addEventListener('click', async (e) => { e.stopPropagation(); if (hist.toolbarEditing) return; if (more.getAttribute('aria-expanded') === 'true') { (await import('../cardMenu.js')).closeMenu(); return; } openSendMenu(more); });
            wrap.append(main, more);
            if (hist.toolbarEditing) markEditable(wrap, id);
            holder.append(wrap); return;
        }
        const b = document.createElement('button'); b.type = 'button'; b.className = 'detail-tool tool-' + id;
        b.title = name; b.setAttribute('aria-label', name);
        b.append(iconEl(def.icon));
        const t = document.createElement('span'); t.className = 'act-label'; t.textContent = def.short(); b.append(t);
        b.addEventListener('click', (e) => { e.stopPropagation(); Promise.resolve().then(() => toolbarRun(id, a)()).catch(() => {}); });
        if (hist.toolbarEditing) markEditable(b, id);
        holder.append(b);
    });
    if (cb) holder.append(cb);
}
// ── Customize: the bar itself is the editor (drag handles) with a tray of the actions that only live in ⋯ ──
const saveToolbar = (items) => {
    toolbarPrefs.items = normalizeToolbar(items);
    try { chrome.storage.sync.set({ [TOOLBAR_PREF]: toolbarPrefs.items }); } catch (_) { /* the bar still follows this session */ }
    layoutDetailActions(); paintToolbarTray();
};
function moveToolbarItem(id, index) {   // index = position among the bar's configured actions; -1 → back to the tray (⋯ menu)
    const items = toolbarPrefs.items.filter(x => x !== id);
    if (index < 0) { if (!items.length) return; } else items.splice(Math.min(index, items.length), 0, id);
    saveToolbar(items);
}
function markEditable(el, id) {
    el.draggable = true; el.dataset.toolId = id; el.classList.add('is-editable');
    if (!el.querySelector('.tool-grip')) { const g = document.createElement('span'); g.className = 'tool-grip'; g.setAttribute('aria-hidden', 'true'); g.textContent = '⋮⋮'; el.prepend(g); }
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('is-dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    el.addEventListener('keydown', (e) => {   // keyboard: Alt+←/→ move, Delete sends it back to ⋯
        const i = toolbarPrefs.items.indexOf(id);
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); moveToolbarItem(id, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))); document.querySelector('#detailTopActions [data-tool-id="' + id + '"]')?.focus(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); moveToolbarItem(id, -1); }
    });
}
function dropIndex(holder, x) {   // where in the bar a dragged item would land
    const tools = [...holder.querySelectorAll('.is-editable')];
    let i = 0; for (const t of tools) { const r = t.getBoundingClientRect(); if (x > r.left + r.width / 2) i++; else break; }
    return i;
}
function wireBarDrop(holder) {
    if (holder.dataset.dnd) return; holder.dataset.dnd = '1';
    holder.addEventListener('click', (e) => { if (hist.toolbarEditing && e.target.closest('.is-editable')) { e.preventDefault(); e.stopPropagation(); } }, true);
    holder.addEventListener('dragover', (e) => { if (!hist.toolbarEditing) return; e.preventDefault(); holder.classList.add('is-drop'); holder.style.setProperty('--drop-x', '1'); });
    holder.addEventListener('dragleave', (e) => { if (!holder.contains(e.relatedTarget)) holder.classList.remove('is-drop'); });
    holder.addEventListener('drop', (e) => { if (!hist.toolbarEditing) return; e.preventDefault(); holder.classList.remove('is-drop'); const id = e.dataTransfer.getData('text/plain'); if (TOOLBAR_CATALOG[id]) moveToolbarItem(id, dropIndex(holder, e.clientX)); });
}
function paintToolbarTray() {
    const topBar = document.getElementById('detailTopBar');
    let tray = document.getElementById('toolbarTray');
    if (!hist.toolbarEditing || !topBar) { if (tray) tray.remove(); return; }
    if (!tray) { tray = document.createElement('div'); tray.id = 'toolbarTray'; tray.className = 'toolbar-tray'; tray.setAttribute('role', 'group'); topBar.after(tray);
        tray.addEventListener('dragover', (e) => { e.preventDefault(); tray.classList.add('is-drop'); });
        tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('is-drop'); });
        tray.addEventListener('drop', (e) => { e.preventDefault(); tray.classList.remove('is-drop'); const id = e.dataTransfer.getData('text/plain'); if (TOOLBAR_CATALOG[id]) moveToolbarItem(id, -1); }); }
    tray.setAttribute('aria-label', T('Customize toolbar…'));
    tray.replaceChildren();
    const h = document.createElement('div'); h.className = 'toolbar-tray-t'; h.textContent = T('Other actions: drag into the bar'); tray.append(h);
    const chips = document.createElement('div'); chips.className = 'toolbar-tray-chips'; tray.append(chips);
    Object.keys(TOOLBAR_CATALOG).filter(id => !toolbarPrefs.items.includes(id) && toolbarAvailable(id, hist.detail)).forEach((id) => {
        const def = TOOLBAR_CATALOG[id];
        const c = document.createElement('button'); c.type = 'button'; c.className = 'toolbar-chip'; c.draggable = true; c.dataset.toolId = id; c.title = def.label();
        const g = document.createElement('span'); g.className = 'tool-grip'; g.textContent = '⋮⋮'; g.setAttribute('aria-hidden', 'true');
        const t = document.createElement('span'); t.textContent = def.short();
        c.append(g, iconEl(def.icon), t);
        c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-dragging'); });
        c.addEventListener('dragend', () => c.classList.remove('is-dragging'));
        c.addEventListener('click', () => moveToolbarItem(id, toolbarPrefs.items.length));   // click / Enter adds at the end (touch, keyboard)
        chips.append(c);
    });
    if (!chips.children.length) { const e = document.createElement('span'); e.className = 'toolbar-tray-empty'; e.textContent = T('Everything is in the bar.'); chips.append(e); }
    const row = document.createElement('div'); row.className = 'toolbar-tray-row'; tray.append(row);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button-secondary btn-sm'; reset.textContent = T('Reset toolbar');
    reset.addEventListener('click', () => saveToolbar(DEFAULT_TOOLBAR.slice()));
    const sp = document.createElement('span'); sp.className = 'source-sp';
    const done = document.createElement('button'); done.type = 'button'; done.className = 'button-primary btn-sm'; done.textContent = T('Done');
    done.addEventListener('click', exitToolbarEdit);
    row.append(reset, sp, done);
}
function enterToolbarEdit() { hist.toolbarEditing = true; layoutDetailActions(); paintToolbarTray(); document.querySelector('#detailTopActions .is-editable')?.focus(); }
function exitToolbarEdit() { hist.toolbarEditing = false; layoutDetailActions(); paintToolbarTray(); }

/** "Back to History" becomes "Back" (the full text stays as tooltip), and just the arrow in a very narrow pane. */
function shortenBackLabel(back, mode) {   // mode: 'full' | 'short' | 'icon'
    if (!back) return;
    const tn = [...back.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim() !== '' || n.nodeType === 3 && back.dataset.fullLabel !== undefined);
    if (!tn) return;
    if (mode === 'full') {
        if (back.dataset.fullLabel !== undefined) { tn.textContent = back.dataset.fullLabel; delete back.dataset.fullLabel; back.removeAttribute('title'); back.removeAttribute('aria-label'); }
        return;
    }
    if (back.dataset.fullLabel === undefined) back.dataset.fullLabel = tn.textContent;
    tn.textContent = mode === 'icon' ? '' : ' ' + T('Back');
    back.title = back.dataset.fullLabel.trim(); back.setAttribute('aria-label', back.title);
}
export function layoutDetailActions() {
    const topBar = document.getElementById('detailTopBar');
    const content = document.getElementById('articleDetailContent');
    const bar = content && content.querySelector('.detail-actions');
    if (!topBar || !bar) return;
    const width = topBar.getBoundingClientRect().width;
    const want = true;   // the joined toolbar is used at every width; narrow panes just show fewer actions, icons only
    const labels = width >= bp('toolbar-labels');
    const more = document.getElementById('detailMoreBtn');
    const back = document.getElementById('detailBackButton');
    let holder = document.getElementById('detailTopActions');
    shortenBackLabel(back, width < bp('toolbar-compact') ? 'icon' : 'short');
    if (want) {
        if (!holder) {
            holder = document.createElement('div'); holder.id = 'detailTopActions'; holder.className = 'detail-toolbar';
            holder.setAttribute('role', 'toolbar'); holder.setAttribute('aria-label', T('Article actions'));
            holder.addEventListener('keydown', (e) => {   // arrow keys move along the bar
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                const l = [...holder.querySelectorAll('button')]; const i = l.indexOf(document.activeElement); if (i < 0) return;
                e.preventDefault(); l[(i + (e.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length].focus();
            });
            back.after(holder);
        }
        wireBarDrop(holder);
        let cb = topBar.querySelector('.card-menu-btn') || bar.querySelector('.card-menu-btn');
        if (cb) cb.classList.add('detail-top-more');
        paintDetailToolbar(holder, cb, width, labels);
        if (!topActions) { if (more) more.hidden = true; bar.hidden = true; topActions = true; }
    } else if (topActions) {
        const cb = holder && holder.querySelector('.card-menu-btn');
        if (cb) { cb.classList.remove('detail-top-more'); bar.append(cb); }
        parkExistingTools();
        if (holder) holder.remove();
        if (more) more.hidden = false;
        bar.hidden = false; topActions = false;
    }
}

/** Read mode: the article in its own tab (reader page: typography, themes, highlights). Falls back to a plain tab. */
async function openReadMode(article) {
    if (article.id) {
        try {
            const url = chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(article.id);
            if (chrome.tabs && chrome.tabs.create) { await chrome.tabs.create({ url }); return; }
            if (window.open(url, '_blank', 'noopener')) return;
        } catch (_) { /* fall through to the plain tab */ }
    }
    const readerArticle = await exportView(article);
    const clean = (html) => cleanUntrustedHtml(new DOMParser().parseFromString(String(html || ''), 'text/html').body).innerHTML;
    const title = escapeHtml(article.title || T('Article'));
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:auto;background:#f4f4f4;color:#333;line-height:1.6;}h2{color:#444;}img{max-width:100%;height:auto;}</style></head>
<body><h1>${title}</h1><h2>${escapeHtml(T('🧙 AI Summary'))}</h2><div>${clean(readerArticle.summary)}</div><h2>${escapeHtml(T('📄 Original Content'))}</h2><div>${clean(article.content || article.html || article.text)}</div></body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
}

/** After "Back": focus the card that was open (or its neighbour when it is gone) and keep it in view. */

/** Placeholder in the article pane while the full record loads, so the switch from the list is instant. */
function showDetailSkeleton() {
    const articleDetail = document.getElementById('articleDetail');
    const content = document.getElementById('articleDetailContent');
    if (!articleDetail || !content) return;
    content.replaceChildren();
    const card = document.createElement('div');
    card.className = 'article-detail-card';
    card.setAttribute('aria-hidden', 'true');
    for (const cls of ['skeleton-line skeleton-title', 'skeleton-line', 'skeleton-line skeleton-short', 'skeleton-line', 'skeleton-line', 'skeleton-line skeleton-short']) {
        const line = document.createElement('div'); line.className = cls; card.appendChild(line);
    }
    content.appendChild(card);
    content.setAttribute('aria-busy', 'true');
    const articleList = document.getElementById('articleList');
    if (articleList) articleList.style.display = 'none';
    const graphContainer = document.getElementById('graphContainer');
    if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
    const historyTopBar = document.getElementById('historyTopBar');
    if (historyTopBar) historyTopBar.style.display = 'none';
    const detailTopBar = document.getElementById('detailTopBar');
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
    playEnter(articleDetail);
}
