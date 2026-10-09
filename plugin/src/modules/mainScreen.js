import { modelEmoji } from './modelBadge.js';
import { SK, articleRecKey } from './storageKeys.js';
import { escapeHtml } from './textUtils.js';
import { debug } from './log.js';
// mainScreen.js
// Handles main screen UI — chat-style summary feed

import StorageManager from './storageManager.js';
import { T, TN } from './feedI18n.js';
import { t } from './i18n.js';
import { paperChips } from './paperInfo.js';
import { aiComplete } from './feedAi.js';
import { modalOpen } from './shortcuts.js';
import { initInstantRead } from './instantRead.js';
import { getReader } from './reader.js';
import { createComposer, samePage, contextRows, statusLines, activeStep } from './composerState.js';
import { answerPreview, newTurn, buildPrompt, parseAnswer, joinContinuation } from './conversation.js';
import { turnEl, renderAnswer } from './qaView.js';
import { typeText } from './typewriter.js';
import { sidebarTokenFromHash, acceptSidebarMessage, SIDEBAR_TOKEN_FIELD } from './sidebarChannel.js';
import { attachCardMenu } from './cardMenu.js';
import { currentLengthSpec } from './summaryLength.js';

export function initMainScreen(ui) {
    const fetchSummaryButton = document.getElementById('fetchSummary');
    const additionalQuestionsInput = document.getElementById('additionalQuestions');
    const languageSelect = document.getElementById('languageSelect');
    const recentEntry = document.getElementById('recentEntry');
    const recentTitle = document.getElementById('recentTitle');
    const recentMeta = document.getElementById('recentMeta');
    const feed = document.getElementById('summaryFeed');

    if (!fetchSummaryButton) return;

    // ── Helpers ─────────────────────────────────────────────────────────
    const getDomain = (url) => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
    };

    const addBubble = (article) => {
        const title = article.title || article.content?.split('\n')[0] || 'Summary';
        const domain = article.url ? getDomain(article.url) : '';
        // Strip <img> tags from AI-generated HTML to prevent 404s on relative paths
        const summaryHtml = (article.summary || '').replace(/<img[^>]*>/gi, '');
        // Plain text preview: strip all HTML tags and truncate to 100 chars
        const textOnly = summaryHtml.replace(/<[^>]+>/g, '').trim();
        const preview = textOnly.length > 100 ? textOnly.slice(0, 100) + '…' : textOnly;
        const date = article.timestamp ? new Date(article.timestamp).toLocaleDateString() : '';

        const tags = article.tags || [];
        const tagsHtml = tags.length ? `<div class="bubble-tags">${tags.map(t => `<span class="bubble-tag">${escapeHtml(t)}</span>`).join('')}</div>` : '';
        const modelHtml = article.modelId ? `<span class="card-model card-model--block">${modelEmoji(article)} ${escapeHtml(article.modelId)}</span>` : '';
        const bubble = document.createElement('div');
        bubble.className = 'summary-bubble';
        if (article.id) bubble.dataset.id = article.id;
        bubble.innerHTML = `
            <div class="summary-bubble-header">
                <span class="summary-bubble-title">${escapeHtml(title.length > 50 ? title.slice(0, 50) + '…' : title)}</span>
                <span class="summary-bubble-domain">${escapeHtml(domain)} · ${date}</span>
            </div>
            <div class="summary-bubble-body">${preview}</div>
            ${tagsHtml}
            ${modelHtml}
        `;
        // 🎓 paper badges (detected from DOI / citation meta; the user's override lives on the index entry)
        {
            const chips = paperChips(article);
            if (chips.length) {
                let row = bubble.querySelector('.bubble-tags');
                if (!row) { row = document.createElement('div'); row.className = 'bubble-tags'; bubble.querySelector('.summary-bubble-body').after(row); }
                chips.slice().reverse().forEach(([tone, text]) => { const s = document.createElement('span'); s.className = 'bubble-tag paper paper-' + tone; s.textContent = text; row.prepend(s); });
            }
        }
        // Click to open in history
        bubble.style.cursor = 'pointer';
        bubble.addEventListener('click', async () => {
            if (ui && typeof ui.showScreen === 'function') {
                ui.showScreen('history');
                // Small delay to let the screen slide in before rendering detail
                setTimeout(() => {
                    import('./articleManager.js').then(mod => mod.showArticleDetail(article));
                }, 400);
            }
        });
        // Menu + Ask / replies / Read again need the saved id. A card shown the moment a summary completes has none yet:
        // decorate() runs again when the save is confirmed (see 'summarySaved').
        bubble._decorate = () => {
            if (bubble.dataset.decorated || !article.id || article.feedStub) return;
            bubble.dataset.decorated = '1'; bubble.dataset.id = article.id;
        // ⋯ actions (copy, share, LocalSend, Kindle, read aloud, delete …)
        {
            const hdr = bubble.querySelector('.summary-bubble-header');
            if (hdr) attachCardMenu(hdr, article, { onRemoved: () => bubble.remove() });
        }
        // 💬 Ask: chat about this (older) summary — the thread opens right under the card.
        {
            const row = document.createElement('div');
            row.className = 'ask-actions';
            const btn = document.createElement('button');
            btn.type = 'button'; btn.className = 'ask-btn'; btn.textContent = T('💬 Ask');
            btn.setAttribute('aria-expanded', 'false');
            const go = (e) => { e.stopPropagation(); askAbout(article, bubble); };
            btn.addEventListener('click', go);
            row.appendChild(btn);
            if (article.qaCount) {
                const c = document.createElement('button');
                c.type = 'button'; c.className = 'ask-count'; c.textContent = TN(article.qaCount, '💬 {n} reply', '💬 {n} replies');
                c.addEventListener('click', go);
                row.appendChild(c);
            }
            // 🔊 Read again: reads this card's summary aloud (pause / play while it speaks). Hidden where the device has no speech engine.
            if (article.summary) {
                const rb = document.createElement('button');
                rb.type = 'button'; rb.className = 'read-btn'; rb.hidden = true;
                const reader = getReader();
                const mine = () => { const m = reader.state.meta; return !!(m && m.tool === 'instant' && m.id === article.id && ['playing', 'paused', 'waiting'].includes(reader.state.state)); };
                const paint = () => {
                    if (!bubble.isConnected && off) { off(); return; }
                    const playing = mine(), paused = playing && reader.state.state === 'paused';
                    rb.textContent = playing ? (paused ? '▶ ' + T('Play') : '❚❚ ' + T('Pause')) : '🔊 ' + T('Read again');
                    rb.classList.toggle('is-speaking', playing);
                };
                const off = reader.onState(paint);
                reader.ready.then((ok) => { rb.hidden = !ok; paint(); });
                rb.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (mine()) { reader.toggle(); return; }
                    if (instant) instant.readHtml(article.summary, article.id);
                });
                row.appendChild(rb);
            }
            bubble.appendChild(row);
        }
        };
        bubble._decorate();
        feed.appendChild(bubble);
        return bubble;
    };

    // Tracks the highest % shown so far in the current streaming session —
    // updateStreamProgress() uses it to ignore any out-of-order/lower update
    // (e.g. a delayed "connecting" message arriving after streaming has
    // already moved the bar further along), so the bar only ever advances.
    let lastShownStreamProgress = 0;
    let streamPhase = 0;          // 0 starting · 1 waiting for the model · 2 writing (never goes back)
    let lastPhaseTitle = '';
    let lastStepPhase = 0;

    const addStreamBubble = (modelName = '', mode = 'local') => {
        // Remove any existing stream bubble
        const old = feed.querySelector('.stream-bubble');
        if (old) old.remove();
        lastShownStreamProgress = 0;
        streamPhase = 0; lastPhaseTitle = '';
        stepsStart = Date.now(); lastStepPhase = 0;

        const emoji = modelEmoji({ connectionMode: mode, modelId: modelName });
        const bubble = document.createElement('div');
        bubble.className = 'stream-bubble';
        bubble.id = 'streamBubble';
        bubble.innerHTML = `
          <div class="sc-head">
            <span class="pulse-dot"></span>
            <span id="streamText" class="sc-title">${T('Starting…')}</span>
            <span id="streamStats" class="sc-stats"></span>
            <span id="streamTimer" class="sc-timer"></span>
          </div>
          <ul id="streamSteps" class="sc-steps" aria-live="polite"></ul>
          <div id="streamModel" class="sc-model">${emoji} ${modelName}</div>
          <div id="streamProgressWrap" class="sc-progress" style="display:none;">
            <div class="sc-progress-track"><div id="streamProgressBar" class="sc-progress-bar" style="width:0%;"></div></div>
          </div>
          <div id="streamPreview" class="sc-preview"></div>
        `;
        feed.appendChild(bubble);
        // Scroll to show the stream bubble
        requestAnimationFrame(() => {
            scrollToNewest();
        });
        // Start elapsed timer
        if (window._streamTimer) clearInterval(window._streamTimer);
        const start = Date.now();
        window._streamTimer = setInterval(() => {
            const el = document.getElementById('streamTimer');
            if (el) {
                const sec = Math.floor((Date.now() - start) / 1000);
                el.textContent = `${sec}s`;
            }
            tickWait();
        }, 1000);
        return bubble;
    };

    const updateStream = (text) => {
        const el = document.getElementById('streamText');
        if (el) el.textContent = text;
    };

    const updateStreamPreview = (text) => {
        const el = document.getElementById('streamPreview');
        if (el && text) {
            const plain = text.replace(/<[^>]+>/g, '').trim();
            // Show the last ~200 chars so new content keeps appearing
            const snippet = plain.length > 200 ? '…' + plain.slice(-200) : plain;
            el.textContent = snippet;
        }
    };

    // Update the estimated output-progress bar (0-99 while streaming).
    const updateStreamProgress = (pct) => {
        const wrap = document.getElementById('streamProgressWrap');
        const bar = document.getElementById('streamProgressBar');
        if (!wrap || !bar) return;
        if (typeof pct !== 'number' || Number.isNaN(pct) || pct <= 0) return;
        const clamped = Math.min(99, Math.max(0, pct));
        // Never let the bar move backwards within a session — the various
        // progress sources (click-time estimate, waiting ramp, word-count
        // estimate) can arrive slightly out of order, and a visible regress
        // reads as broken even though it's just noise in the estimate.
        if (clamped < lastShownStreamProgress) return;
        lastShownStreamProgress = clamped;
        wrap.style.display = 'block';
        bar.style.width = `${clamped}%`;
    };

    const removeStreamBubble = () => {
        const el = document.getElementById('streamBubble');
        if (el) el.remove();
        if (window._streamTimer) {
            clearInterval(window._streamTimer);
            window._streamTimer = null;
        }
    };

    // ── Conversation state (in memory; persisted conversations come later) ──
    let lastContext = null;          // summaryContext of the running/last summary
    let conversation = null;         // { url, title, content, summary, turns:[{q,a}] }
    let activeTabId = null;
    let workingElsewhere = false;   // a summary runs in another tab: the button queues this page instead of stopping
    let liveBubbleEl = null;          // its card element
    const savedIds = {};              // url → id, when 'summarySaved' arrives before 'summaryComplete'
    let liveBubbleArticle = null;     // the article object behind the newest bubble
    const bar = document.querySelector('.controls-bar');
    // --floating-stack-height follows the real height of the controls bar (page chip, wrapped input, open panels…)
    // instead of the 250px CSS estimate, so the feed's bottom padding always clears it.
    if (bar && typeof ResizeObserver === 'function') {
        const syncControlsHeight = () => {
            const h = Math.ceil(bar.getBoundingClientRect().height);
            if (h > 0) document.documentElement.style.setProperty('--controls-overlay-height', h + 'px');
        };
        new ResizeObserver(syncControlsHeight).observe(bar);
        syncControlsHeight();
    }

    const esc = escapeHtml;
    const usedOpen = () => { try { return localStorage.getItem('aish:usedOpen') === '1'; } catch (_) { return false; } };
    const setUsedOpen = (v) => { try { localStorage.setItem('aish:usedOpen', v ? '1' : '0'); } catch (_) { /* storage unavailable */ } };
    // Scroll to the newest content. The scrolling element is whichever ancestor really overflows (the screen, not always #feedScroll);
    // a lone card is aligned just below the (fixed, translucent) header instead of sliding under it (CSS scroll-margin-top on the card).
    const scrollParent = (el) => {
        for (let p = el; p; p = p.parentElement) {
            const o = getComputedStyle(p).overflowY;
            if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
        }
        return null;
    };
    const scrollToNewest = () => {
        try {
            const cards = feed.querySelectorAll('.summary-bubble');
            // a lone card is shown from its top — unless a conversation is running under it: then follow the newest turn
            if (cards.length === 1 && !feed.querySelector('.chat-turn, .chat-turn-group')) { cards[0].scrollIntoView({ block: 'start', behavior: 'auto' }); return; }
            const sp = scrollParent(feed) || document.getElementById('feedScroll');
            if (sp) sp.scrollTop = sp.scrollHeight;
        } catch (_) { /* layout unavailable */ }
    };
    const scrollFeed = () => requestAnimationFrame(scrollToNewest);

    // Steps: ✓ done · … active (the "Sent to <model>" line also shows how long we have been waiting) · dimmed = still to come.
    let stepsStart = Date.now();
    const renderSteps = (ctx) => {
        const ul = document.getElementById('streamSteps');
        if (!ul || !ctx) return;
        const lines = statusLines(ctx);
        const now = activeStep(lines, streamPhase);
        ul.innerHTML = lines.map((l, i) => {
            const cls = i < now ? 'sc-step' : i === now ? 'sc-step sc-step--now' : 'sc-step sc-step--todo';
            const wait = (i === now && streamPhase < 2 && i === lines.length - 2) ? ' <span class="sc-wait"></span>' : '';
            return `<li class="${cls}">${esc(l)}${wait}</li>`;
        }).join('');
        tickWait();
    };
    const tickWait = () => {
        const w = document.querySelector('#streamSteps .sc-wait');
        if (w) w.textContent = '· ' + T('waiting {s}s', { s: Math.floor((Date.now() - stepsStart) / 1000) });
    };

    /** Collapsible "What I used" row under a finished summary. */
    const usedRow = (ctx) => {
        if (!ctx) return null;
        const det = document.createElement('details');
        det.className = 'sc-used';
        det.open = usedOpen();
        det.innerHTML = `<summary>${esc(T('What I used'))}</summary>`
            + `<ul>${contextRows(ctx).map(r => `<li data-k="${r.key}">${esc(r.text)}</li>`).join('')}</ul>`;
        det.addEventListener('toggle', () => setUsedOpen(det.open));
        const cut = contextRows(ctx).find(r => r.warn);
        if (!cut) return det;
        const box = document.createElement('div');
        const note = document.createElement('div');
        note.className = 'sc-cut'; note.setAttribute('role', 'note');
        const hint = T('Raise the context length in Ollama (OLLAMA_CONTEXT_LENGTH) or use a model with a longer context.');
        note.append(Object.assign(document.createElement('strong'), { textContent: '⚠ ' + cut.text }), document.createElement('br'), document.createTextNode(hint));
        box.append(note, det);
        return box;
    };

    const composer = createComposer(bar, {
        onChange: (next) => {
            if (next !== 'working') workingElsewhere = false;
            additionalQuestionsInput.style.height = '';
            if (next === 'fetch') refreshFetchExtras(); else clearNote();
            if (next === 'followup') showConversationChip();
            if (next === 'followup' && additionalQuestionsInput.value.trim()) sendFollowUp(additionalQuestionsInput.value.trim());
        }
    });
    // ⌘/Ctrl+Enter: Summarize (fetch state) or Send (follow-up), from the focus field or anywhere on this screen.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
        if (document.body.dataset.screen !== 'main' || !composer || composer.state === 'working') return;
        if (modalOpen()) return;
        if (fetchSummaryButton.disabled) return;
        e.preventDefault();
        fetchSummaryButton.click();
    });
    additionalQuestionsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.isComposing && composer && composer.state === 'followup') {
            e.preventDefault();
            const q = additionalQuestionsInput.value.trim();
            if (q && !fetchSummaryButton.disabled) sendFollowUp(q);
        }
    });
    additionalQuestionsInput.addEventListener('input', () => {
        if (!composer || composer.state === 'fetch') { additionalQuestionsInput.style.height = ''; return; }
        additionalQuestionsInput.style.height = 'auto';
        additionalQuestionsInput.style.height = Math.min(additionalQuestionsInput.scrollHeight, 96) + 'px';
    });
    const resetToFetch = () => {
        if (composer) { composer.set('fetch'); composer.refresh(); }
        else { fetchSummaryButton.disabled = false; fetchSummaryButton.textContent = '✨ Summarize'; }
    };

    // Fetch state extras: the page in the active tab as a chip INSIDE the input card (it flies into the thread on Fetch).
    // (The last summary is reachable through the Ask button on its card in the feed.)
    let extrasToken = 0;
    const clip = (x, n) => { x = String(x || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
    const clearNote = () => {
        extrasToken++;
        document.getElementById('pageCard')?.remove();
        document.getElementById('convChip')?.remove();
    };
    // A PDF attached in the popup (button or drag & drop): extracted here, summarized instead of the open tab.
    let attached = null;          // { name, html, text } once extracted
    let attaching = '';           // file name while it is being read
    let attachError = '';
    const PDF_ERRORS = () => ({
        PASSWORD: T('This PDF is password protected.'),
        EMPTY: T('This PDF has no selectable text (probably a scan). Text recognition is not supported yet.'),
        NOT_PDF: T('This file is not a readable PDF.')
    });
    const attachmentChip = () => {
        const chip = document.createElement('div');
        chip.id = 'pageCard'; chip.className = 'page-chip page-chip--attach';
        chip.dataset.title = attached ? attached.name : attaching; chip.dataset.host = 'PDF';
        const txt = document.createElement('div'); txt.className = 'page-chip-txt';
        const title = document.createElement('div'); title.className = 'page-chip-title'; title.textContent = '📎 ' + clip(chip.dataset.title, 80);
        const meta = document.createElement('div'); meta.className = 'page-chip-meta';
        meta.textContent = attachError || (attaching ? T('Reading PDF…') : T('PDF · {n} words', { n: (attached.text.match(/\S+/g) || []).length }));
        txt.append(title, meta); chip.appendChild(txt);
        const x = document.createElement('button'); x.type = 'button'; x.className = 'page-chip-x'; x.textContent = '✕';
        x.title = T('Remove attachment'); x.setAttribute('aria-label', T('Remove attachment'));
        x.addEventListener('click', () => { attached = null; attaching = ''; attachError = ''; refreshFetchExtras(); });
        chip.appendChild(x);
        return chip;
    };
    const attachPdf = async (file) => {
        if (!file) return;
        if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { attachError = T('This file is not a readable PDF.'); attaching = ''; attached = null; refreshFetchExtras(); return; }
        attached = null; attachError = ''; attaching = file.name; refreshFetchExtras();
        try {
            if (file.size > 80 * 1024 * 1024) throw Object.assign(new Error('big'), { code: 'BIG' });
            const { extractPdfBytes } = await import('../content/pdfExtractor.js');
            const ex = await extractPdfBytes(await file.arrayBuffer());
            attached = { name: file.name, html: ex.html, text: ex.text };
            attachError = '';
        } catch (err) {
            attached = null;
            attachError = (err && err.code === 'BIG') ? T('This PDF is too large (limit 80 MB).') : (PDF_ERRORS()[err && err.code] || T('Could not read this PDF.'));
        }
        attaching = '';
        refreshFetchExtras();
    };
    const buildAttachUi = () => {
        const row = document.getElementById('chipRow');
        if (!row || document.getElementById('chipAttach')) return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/pdf,.pdf'; input.hidden = true; input.id = 'attachPdfInput';
        input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; attachPdf(f); });
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'chipAttach'; b.className = 'chip chip-attach';
        b.title = T('Attach a PDF to summarize'); b.setAttribute('aria-label', T('Attach a PDF to summarize'));
        const ic = document.createElement('span'); ic.className = 'chip-icon'; ic.textContent = '📎';
        const lb = document.createElement('span'); lb.textContent = 'PDF';
        b.append(ic, lb);
        b.addEventListener('click', () => input.click());
        row.append(b, input);
        // Drag & drop a PDF anywhere on the Summarize screen.
        const screen = document.getElementById('mainScreen');
        const hasPdf = (e) => e.dataTransfer && [...(e.dataTransfer.items || [])].some(i => i.kind === 'file');
        if (screen) {
            screen.addEventListener('dragover', (e) => { if (hasPdf(e)) { e.preventDefault(); screen.classList.add('drop-pdf'); } });
            screen.addEventListener('dragleave', (e) => { if (e.target === screen) screen.classList.remove('drop-pdf'); });
            screen.addEventListener('drop', (e) => { screen.classList.remove('drop-pdf'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); attachPdf(f); } });
        }
    };
    // The tab title is often empty, still "Loading…", or just the URL/host. Fall back to the page's own
    // og:title / twitter:title / h1 / <title> (read through scripting; restricted pages just keep the host).
    const weakTitle = (t, tab) => {
        t = String(t || '').trim();
        return !t || /^(loading|untitled|new tab)\b/i.test(t) || t === tab.url || t === hostOf(tab.url) || t.replace(/^https?:\/\//, '') === tab.url.replace(/^https?:\/\//, '');
    };
    const resolvePageTitle = async (tab) => {
        if (!weakTitle(tab.title, tab)) return tab.title;
        try {
            if (tab.id == null || !chrome.scripting?.executeScript) return tab.title || '';
            const [res] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const m = (sel) => (document.querySelector(sel)?.getAttribute('content') || '').trim();
                    const h1 = (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim();
                    return m('meta[property="og:title"]') || m('meta[name="twitter:title"]') || h1 || (document.title || '').trim();
                }
            });
            return (res && res.result) || tab.title || '';
        } catch (_) { return tab.title || ''; }
    };
    const refreshFetchExtras = async () => {
        clearNote();
        const token = extrasToken;
        if (!composer || composer.state !== 'fetch' || !bar) return;
        if (attached || attaching || attachError) {
            const pill = bar.querySelector('.composer-pill');
            if (pill) pill.insertBefore(attachmentChip(), pill.firstChild);
            return;
        }
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        if (token !== extrasToken || composer.state !== 'fetch') return;
        const inputCard = bar.querySelector('.composer-pill');
        if (tab && tab.url && isInjectableUrl(tab.url) && inputCard) {
            const pageTitle = await resolvePageTitle(tab);
            if (token !== extrasToken || composer.state !== 'fetch') return;
            const different = !!conversation && !samePage(conversation.url, tab.url);
            const chip = document.createElement('div');
            chip.id = 'pageCard';
            chip.className = 'page-chip' + (different ? ' page-chip--different' : '');
            chip.dataset.title = pageTitle || ''; chip.dataset.host = hostOf(tab.url);
            if (tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)) {
                const ic = document.createElement('img'); ic.className = 'page-chip-ic'; ic.alt = ''; ic.src = tab.favIconUrl;
                ic.addEventListener('error', () => ic.remove());
                chip.appendChild(ic);
            }
            const txt = document.createElement('div'); txt.className = 'page-chip-txt';
            const title = document.createElement('div'); title.className = 'page-chip-title'; title.textContent = clip(pageTitle || chip.dataset.host, 80);
            const meta = document.createElement('div'); meta.className = 'page-chip-meta';
            meta.textContent = (different ? T('different page') + ' · ' : '') + chip.dataset.host;
            txt.append(title, meta);
            chip.appendChild(txt);
            inputCard.insertBefore(chip, inputCard.firstChild);
        }
    };

    /** Follow-up state: the page the conversation is about, inside the input card (also for a resumed old summary). */
    const showConversationChip = () => {
        const inputCard = bar && bar.querySelector('.composer-pill');
        if (!conversation || !inputCard || document.getElementById('convChip')) return;
        const chip = document.createElement('div');
        chip.id = 'convChip';
        chip.className = 'page-chip page-chip--conv';
        const fav = conversation.meta && conversation.meta.favicon;
        if (fav && /^https?:|^data:/.test(fav)) {
            const ic = document.createElement('img'); ic.className = 'page-chip-ic'; ic.alt = ''; ic.src = fav;
            ic.addEventListener('error', () => ic.remove());
            chip.appendChild(ic);
        }
        if (conversation.meta && conversation.meta.description) chip.title = conversation.meta.description;
        const txt = document.createElement('div'); txt.className = 'page-chip-txt';
        const title = document.createElement('div'); title.className = 'page-chip-title'; title.textContent = clip(conversation.title || hostOf(conversation.url), 80);
        const meta = document.createElement('div'); meta.className = 'page-chip-meta';
        meta.textContent = [conversation.detached ? T('Continuing') : '', (conversation.meta && conversation.meta.siteName) || hostOf(conversation.url)].filter(Boolean).join(' · ');
        txt.append(title, meta); chip.appendChild(txt);
        const back = document.createElement('button');
        back.type = 'button'; back.className = 'conv-back'; back.innerHTML = '<span aria-hidden="true">‹</span> ' + esc(T('Back'));
        back.title = T('Back to this page') + ' (⌘N)'; back.setAttribute('aria-label', T('Back to this page'));
        back.addEventListener('click', () => startNew());
        chip.insertBefore(back, chip.firstChild);
        inputCard.insertBefore(chip, inputCard.firstChild);
    };

    /** The page chip leaves the input card and lands as the first bubble of the thread (FLIP). */
    const flyIn = (el, from) => {
        if (!from || typeof el.animate !== 'function') return;
        try {
            scrollToNewest();
            const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 }); return; }
            const to = el.getBoundingClientRect();
            if (!to.width || !to.height) return;
            el.style.transformOrigin = 'top left';
            el.animate([
                { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.5 },
                { transform: 'none', opacity: 1 }
            ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
        } catch (_) { /* animation is cosmetic */ }
    };

    let optOutUrl = null;
    const RESUME_WINDOW_MS = 12 * 3600 * 1000;
    /** Back on a page that was just summarized: pick its follow-up conversation up again (same session, or from storage). */
    const resumeForPage = async () => {
        if (!composer || composer.state !== 'fetch' || attached || attaching) return;
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        if (!tab || !tab.url || !isInjectableUrl(tab.url) || composer.state !== 'fetch') return;
        if (optOutUrl && !samePage(optOutUrl, tab.url)) optOutUrl = null;
        if (optOutUrl) return;
        if (conversation && samePage(conversation.url, tab.url)) {
            composer.set('followup'); showConversationChip(); renderSuggestions(); return;
        }
        if (conversation && !conversation.detached) return;
        let list = [];
        try { list = await StorageManager.getArticlesIndex(); } catch (_) { return; }
        const hit = (list || []).filter(a => a && a.id && !a.feedStub && a.url && samePage(a.url, tab.url) && Date.now() - new Date(a.timestamp).getTime() < RESUME_WINDOW_MS)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
        if (!hit || composer.state !== 'fetch') return;
        const bubble = [...feed.querySelectorAll('.summary-bubble')].find(b => b.dataset.id === hit.id);
        if (bubble) await askAbout(hit, bubble);
    };

    /** Back to this page (chip button / ⌘N): back to the initial Fetch Summary state. Nothing is deleted — the summary is in History. */
    const startNew = () => {
        if (composer && composer.state === 'working') return;
        getActiveTab().then(t => { optOutUrl = (t && t.url) || null; }).catch(() => {});   // the user chose a fresh summary of this page: do not jump back into its conversation
        clearThread();
        conversation = null; lastContext = null;
        clearNote();
        additionalQuestionsInput.value = '';   // language / length / mode / model stay as they were
        resetToFetch();
        refreshFetchExtras();
        additionalQuestionsInput.focus();
    };
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n' && conversation) {
            e.preventDefault();
            startNew();
        }
    });

    buildAttachUi();
    refreshFetchExtras();

    // While a summary runs in one tab, the button is "Stop" only on THAT tab. On any other tab it reads "Summarize" and
    // puts the page in line (see the summary queue below), so a second summary can be started from a different tab.
    const paintWorkingButton = () => {
        if (!composer || composer.state !== 'working') { workingElsewhere = false; return; }
        composer.refresh();
        if (workingElsewhere) {
            const w = t('navSummarize');
            fetchSummaryButton.dataset.state = 'fetch';
            fetchSummaryButton.textContent = '✨ ' + (w === 'navSummarize' ? 'Summarize' : w);
        }
    };
    const syncWorkingButton = async () => {
        if (!composer || composer.state !== 'working') { if (workingElsewhere) { workingElsewhere = false; } return; }
        let tab = null, jobs = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        jobs = await bgSend({ action: 'summaryJobs' });
        if (composer.state !== 'working') { workingElsewhere = false; return; }
        const r = jobs && jobs.running;
        const elsewhere = !!(tab && tab.id != null && r && r.tabId !== tab.id);
        if (elsewhere !== workingElsewhere) { workingElsewhere = elsewhere; paintWorkingButton(); }
    };

    // Different-page rule: when the active tab is another page than the conversation, offer a fresh summary.
    const checkPage = async () => {
        if (composer && composer.state === 'working') { syncWorkingButton(); return; }
        if (!composer) return;
        if (composer.state === 'fetch') { refreshFetchExtras(); resumeForPage(); return; }
        if (!conversation || conversation.detached) return;
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        if (!tab || !tab.url) return;
        if (!samePage(conversation.url, tab.url)) composer.set('fetch');   // onChange draws the page card + link
    };
    try {
        chrome.tabs?.onActivated?.addListener(checkPage);
        chrome.tabs?.onUpdated?.addListener((id, info) => { if (info && info.url) checkPage(); });
    } catch (_) { /* tabs API unavailable (hybrid sidebar iframe) */ }
    window.addEventListener('focus', checkPage);

    /** Where thread elements go: under the card the user asked about, else at the end of the feed (the live summary). */
    function placeThread(el) {
        const host = conversation && conversation.host;
        (host && host.isConnected ? host : feed).appendChild(el);
    }

    /** Remove the visible thread (turns, suggestions, "what I used", the Ask host under an older card). */
    function clearThread() {
        feed.querySelectorAll('.chat-turn, .chat-turn-group, .sc-used-wrap, .chat-suggest, .ask-thread').forEach(n => n.remove());
        feed.querySelectorAll('.summary-bubble.ask-open').forEach(b => { b.classList.remove('ask-open'); const x = b.querySelector('.ask-btn'); if (x) x.setAttribute('aria-expanded', 'false'); });
    }

    const paintAskCount = () => {
        const b = conversation && conversation.bubble; if (!b) return;
        const row = b.querySelector('.ask-actions'); if (!row) return;
        let c = row.querySelector('.ask-count');
        if (!c) { c = document.createElement('button'); c.type = 'button'; c.className = 'ask-count'; row.appendChild(c); }
        c.textContent = TN(conversation.turns.length, '💬 {n} reply', '💬 {n} replies');
    };

    /** Ask on an older summary card: load its stored turns, put the thread under that card, composer in follow-up mode. */
    async function askAbout(article, bubble) {
        if (!composer || composer.state === 'working' || !article || !article.id) return;
        if (conversation && conversation.bubble === bubble) { bubble.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); additionalQuestionsInput.focus(); return; }
        let full = null;
        try { full = await StorageManager.getArticleFull(article.id); } catch (_) { /* fall back to the card */ }
        let turns = [], pool = [], quick = {};
        try { turns = await StorageManager.getConversation(article.id); } catch (_) { turns = []; }
        try { pool = await StorageManager.getSuggested(article.id); } catch (_) { pool = []; }
        try { quick = await StorageManager.getSuggestedAnswers(article.id); } catch (_) { quick = {}; }
        if (!bubble.isConnected) return;
        clearThread();
        const f = full || article;
        conversation = {
            id: article.id, url: f.url || article.url || '', title: f.title || article.title || '', content: f.content || '', summary: f.summary || article.summary || '',
            meta: f.meta || (f.favicon ? { favicon: f.favicon } : {}), turns: Array.isArray(turns) ? turns : [], pool: Array.isArray(pool) ? pool.slice() : [], quick: quick || {}, bubble, detached: true
        };
        try { instant && instant.refresh(); } catch (_) { /* optional */ }
        const host = document.createElement('div');
        host.className = 'ask-thread';
        bubble.after(host);
        conversation.host = host;
        bubble.classList.add('ask-open');
        const btn = bubble.querySelector('.ask-btn'); if (btn) btn.setAttribute('aria-expanded', 'true');
        conversation.turns.forEach(t => host.appendChild(turnEl(t, { onPin: persistConversation, onSource: revealOnPage })));
        renderSuggestions();
        clearNote();
        composer.set('followup');
        showConversationChip();   // composer.set() is a no-op when it already is in follow-up: the chip (with its Back button) must still follow the new conversation
        try { bubble.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { /* cosmetic */ }
        additionalQuestionsInput.focus({ preventScroll: true });
    }

    function addTurn(cls, text) {
        const el = document.createElement('div');
        el.className = `chat-turn ${cls}`;
        el.textContent = text;
        placeThread(el);
        scrollFeed();
        return el;
    }

    const persistConversation = () => {
        if (conversation && conversation.id) StorageManager.saveConversation(conversation.id, conversation.turns, conversation.pool, conversation.quick).catch(() => {});
    };

    const revealOnPage = (quote, chip) => {
        if (!conversation || activeTabId == null) return;
        getActiveTab().then(tab => {
            if (!tab || !samePage(conversation.url, tab.url)) { chip.title = T('Open the page to jump to this passage') + ' — ' + quote; return; }
            sendMessageToTab(tab.id, { action: 'revealQuote', quote }).catch(() => {});
        }).catch(() => {});
    };

    /** Suggestion chips under the thread: the unused part of the pool (initial QUESTIONS + the ones that came with each answer). */
    function renderSuggestions() {
        feed.querySelector('.chat-suggest')?.remove();
        if (!conversation) return null;
        const asked = new Set(conversation.turns.map(t => t.q.trim().toLowerCase()));
        conversation.pool = (conversation.pool || []).filter((q, i, a) => !asked.has(q.trim().toLowerCase()) && a.findIndex(x => x.trim().toLowerCase() === q.trim().toLowerCase()) === i);
        const sug = document.createElement('div');
        sug.className = 'chat-suggest';
        conversation.pool.slice(0, 3).forEach((q) => {
            const c = document.createElement('button');
            c.type = 'button'; c.className = 'chat-suggest-chip'; c.textContent = q;
            c.addEventListener('click', () => sendFollowUp(q));
            sug.appendChild(c);
        });
        if (sug.children.length) placeThread(sug);
        return sug;
    }

    /** Is the active connection a local Ollama model? (then the full answer is requested without asking) */
    async function isOllamaActive() {
        try {
            const s = await chrome.storage.sync.get(['connectionMode', 'activeService']);
            return s.connectionMode === 'local' && String(s.activeService || '').toLowerCase() === 'ollama';
        } catch (_) { return false; }
    }

    async function sendFollowUp(q) {
        if (!conversation || !q) return;
        feed.querySelector('.chat-suggest')?.remove();
        additionalQuestionsInput.value = '';
        fetchSummaryButton.disabled = true;
        try { instant && instant.startChat(q); } catch (_) { /* optional */ }
        const qEl = addTurn('chat-q', q);
        // A suggested question comes with a short answer: type it out like a person while the full answer is requested.
        const quickText = (conversation.quick && conversation.quick[q]) || '';
        const ans = addTurn('chat-a chat-a--pending', quickText ? '' : T('Thinking…'));
        // The model continues the short answer (it is told what is on screen): nothing is wiped, the text just grows.
        let typer = null, typing = false, typed = '', cont = '', fullDone = false, failed = false;
        const more = document.createElement('div');
        more.className = 'chat-more'; more.setAttribute('role', 'status');
        more.innerHTML = `<span class="chat-more-label">${escapeHtml(T('Thinking more…'))}</span><i></i><i></i><i></i><button type="button" class="chat-more-stop"></button>`;
        const stopBtn = more.querySelector('.chat-more-stop');
        stopBtn.textContent = T('■ Stop');
        const ctrl = new AbortController();
        let stopped = false;
        // Local Ollama models are slow but free: start the full answer straight away so it is (partly) ready when the short one is read.
        // Paid / cloud models: the short answer stands, the user decides whether the full one is worth the tokens.
        const auto = !quickText || await isOllamaActive();
        // Happy with the short answer? Stop keeps it (and what was already written) and cancels the request.
        stopBtn.addEventListener('click', () => { stopped = true; fullDone = true; ctrl.abort(); });
        const paint = () => {
            if (failed) return;
            renderAnswer(ans, typing ? typed : joinContinuation(quickText, cont));
            more.classList.toggle('is-writing', !typing && !!cont);   // label gone once text flows, the Stop button stays
            scrollFeed();
        };
        if (quickText) {
            const reduce = document.documentElement.getAttribute('data-motion') === 'reduce';
            typing = true;
            ans.classList.add('chat-a--quick');
            ans.after(more);
            more.hidden = !auto;
            scrollFeed();
            typer = typeText(quickText, (t) => { typed = t; paint(); try { instant && instant.chatText(t); } catch (_) { /* optional */ } }, { fast: () => fullDone, instant: reduce });   // read aloud as it is typed
            typer.done.then(() => { typing = false; paint(); try { instant && instant.chatText(joinContinuation(quickText, cont)); } catch (_) { /* optional */ } });
        }
        try {
            if (!auto) {
                await typer.done;
                const dig = document.createElement('div');
                dig.className = 'chat-dig';
                dig.innerHTML = '<button type="button" class="chat-dig-go"></button><button type="button" class="chat-dig-skip"></button>';
                dig.querySelector('.chat-dig-go').textContent = T('Dig deeper');
                dig.querySelector('.chat-dig-skip').textContent = T('That is enough');
                ans.after(dig);
                scrollFeed();
                fetchSummaryButton.disabled = false;
                const deeper = await new Promise((res) => {
                    dig.querySelector('.chat-dig-go').addEventListener('click', () => res(true));
                    dig.querySelector('.chat-dig-skip').addEventListener('click', () => res(false));
                });
                dig.remove();
                fetchSummaryButton.disabled = true;
                if (!deeper) { stopped = true; throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); }
                more.hidden = false;
                more.classList.remove('is-writing');
                ans.after(more);
            }
            const { system, user } = buildPrompt({ ...conversation, question: q, draft: quickText });
            const raw = await aiComplete(system, user, null, quickText ? ctrl.signal : null, (m) => {
                // Stream the continuation in as it is written (cleaned of HTML / code fences / the SOURCES line).
                const t = m && m.text ? answerPreview(m.text) : '';
                if (!t) return;
                cont = t;
                if (!typing) paint();      // while the short answer is still being typed, it keeps going first
                if (!typing) { try { instant && instant.chatText(joinContinuation(quickText, t)); } catch (_) { /* optional */ } }   // never speak ahead of the typed short answer
            }, { partial: true });
            fullDone = true;
            if (typer) await typer.done;
            more.remove();
            const parsed = parseAnswer(raw, conversation.content);
            const { sources, questions, quick } = parsed;
            const a = joinContinuation(quickText, parsed.a);
            try { instant && instant.chatDone(a || ''); } catch (_) { /* optional */ }
            const turn = newTurn(conversation.turns, { q, a: a || T('No answer.'), sources });
            conversation.turns.push(turn);
            try { instant && instant.refresh(); } catch (_) { /* optional */ }
            paintAskCount();
            const el = turnEl(turn, { onPin: persistConversation, onSource: revealOnPage });
            qEl.remove(); ans.replaceWith(el);
            // Fresh suggestions arrive with the answer (no extra request); unused older ones stay in the pool.
            conversation.pool = [...(questions || []), ...(conversation.pool || [])];
            conversation.quick = { ...(conversation.quick || {}), ...(quick || {}) };
            renderSuggestions();
            persistConversation();
        } catch (err) {
            if (stopped) {
                // Keep the short answer (finish typing at once) and only the complete sentences of what was already written.
                if (typer) await typer.done;
                more.remove();
                const keep = (cont.match(/^[\s\S]*[.!?…。!?](?=\s|$)/) || [''])[0];
                const a = joinContinuation(quickText, keep);
                try { instant && instant.chatDone(a || ''); } catch (_) { /* optional */ }
                const turn = newTurn(conversation.turns, { q, a, sources: [] });
                conversation.turns.push(turn);
                try { instant && instant.refresh(); } catch (_) { /* optional */ }
                paintAskCount();
                qEl.remove(); ans.replaceWith(turnEl(turn, { onPin: persistConversation, onSource: revealOnPage }));
                renderSuggestions();
                persistConversation();
                fetchSummaryButton.disabled = false;
                scrollFeed();
                return;
            }
            failed = true;
            if (typer) typer.stop();
            more.remove();
            try { instant && instant.abort(); } catch (_) { /* optional */ }
            ans.textContent = (quickText ? quickText + '\n' : '') + '❌ ' + ((err && err.message) || T('AI request failed'));
            ans.classList.remove('chat-a--pending');
            renderSuggestions();
        }
        fetchSummaryButton.disabled = false;
        scrollFeed();
    }

    const loadFeed = async () => {
        const articles = await StorageManager.getArticlesIndex();
        feed.innerHTML = '';
        if (articles && articles.length > 0) {
            if (recentEntry) recentEntry.style.display = 'none';
            const sorted = articles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            // Reverse so oldest is first, newest at bottom (scroll targets it)
            sorted.reverse();
            // Take the last 10 (newest) — if more than 10, slice from the end
            const recent = sorted.length > 10 ? sorted.slice(-10) : sorted;
            recent.forEach(addBubble);
            // Scroll to newest (bottom of feed)
            requestAnimationFrame(() => {
                scrollToNewest();
            });
            try { refreshFetchExtras(); resumeForPage(); } catch (_) { /* composer not ready yet */ }
        } else {
            if (recentEntry) recentEntry.style.display = 'flex';
            if (recentTitle) recentTitle.textContent = T('No recent summaries');
            if (recentMeta) {
                const mac = /Mac|iPhone|iPad/i.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
                recentMeta.textContent = T('Summarize a page to see it here') + ' · ' + (mac ? '⌘ + Shift + E' : 'Ctrl + Shift + E');
            }
        }
    };

    // ── Click welcome entry to jump to history ─────────────────────────
    if (recentEntry) {
        recentEntry.addEventListener('click', () => {
            if (ui && typeof ui.showScreen === 'function') ui.showScreen('history');
        });
        recentEntry.style.cursor = 'pointer';
    }

    // ── Load feed on init ──────────────────────────────────────────────
    loadFeed();

    // ── Onboarding / Empty State ───────────────────────────────────────
    // If the user has no articles AND isn't authenticated with byphil Cloud
    // AND hasn't set up a custom API key, show the onboarding login mask
    // instead of a blank feed.
    const onboardingContainer = document.getElementById('mainScreenOnboarding');
    const feedScroll = document.getElementById('feedScroll');
    const controlsBar = document.querySelector('.controls-bar');

    const evaluateOnboarding = async () => {
        const data = await StorageManager.get([SK.articlesIndex, SK.token, SK.servicesConfig, 'activeService', 'connectionMode']);
        const hasArticles = Array.isArray(data[SK.articlesIndex]) && data[SK.articlesIndex].length > 0;
        const isCloudAuthed = !!data[SK.token];
        // Keyless providers (e.g. Ollama) count as configured without an API key.
        let keyOptional = false;
        try { keyOptional = !!(await StorageManager.getServices()).find(s => s.id === data.activeService)?.apiKeyOptional; } catch (e) { /* services.json unreachable → treat the key as required */ }
        const hasCustomApi = data.connectionMode === 'local'
            && (keyOptional || !!data[SK.servicesConfig]?.[data.activeService]?.apiKey);

        const showOnboarding = !hasArticles && !isCloudAuthed && !hasCustomApi;

        if (onboardingContainer) onboardingContainer.style.display = showOnboarding ? 'flex' : 'none';
        if (feedScroll) feedScroll.style.display = showOnboarding ? 'none' : 'flex';
        // Only hide the recent-entry when onboarding is shown. When onboarding
        // is NOT shown, leave recentEntry alone — loadFeed() already controls
        // its visibility based on whether articles exist. (Setting it to ''
        // here would override loadFeed's 'none' and wrongly show the empty
        // state even when there are recent summaries.)
        if (recentEntry && showOnboarding) recentEntry.style.display = 'none';
        // Hide the input card / controls bar while onboarding is active so
        // there's no visual conflict with the login mask.
        if (controlsBar) controlsBar.style.display = showOnboarding ? 'none' : '';

        if (showOnboarding) {
            setupOnboardingExtras(ui);
        }
    };

    evaluateOnboarding();

    // The onboarding mask's email/OTP login is handled by the shared
    // authManager module (same implementation as the Settings screen).
    // Whenever auth state changes — e.g. the user finishes signing in —
    // re-evaluate whether the onboarding mask should still be shown, so we
    // can swap over to the summary feed without reloading the popup.
    document.addEventListener('aish:authStateChanged', evaluateOnboarding);

    /** The "Summarize this page" bubble that opens a thread (page info + optional focus), animated from the page chip. */
    const addFirstBubble = (pageInfo, focus, chipRect) => {
        const first = document.createElement('div');
        first.className = 'chat-turn chat-q chat-q--first';
        const l1 = document.createElement('div'); l1.textContent = T('Summarize this page');
        first.appendChild(l1);
        const pageLine = [pageInfo && pageInfo.title, pageInfo && pageInfo.host].filter(Boolean).join(' · ');
        if (pageLine) { const lp = document.createElement('div'); lp.className = 'chat-q-sub'; lp.textContent = clip(pageLine, 80); first.appendChild(lp); }
        if ((focus || '').trim()) { const l2 = document.createElement('div'); l2.className = 'chat-q-sub'; l2.textContent = T('Focus: {text}', { text: focus.trim() }); first.appendChild(l2); }
        feed.appendChild(first);
        flyIn(first, chipRect);
        return first;
    };

    /** A summary that was NOT started by this panel's button (e.g. from the on-page highlights tool): show the same progress UI. */
    const adoptRun = (ctx) => {
        if (!composer || composer.state === 'working') return;
        composer.set('working');
        clearNote();
        feed.querySelectorAll('.chat-turn, .chat-turn-group, .sc-used-wrap, .chat-suggest').forEach(n => n.remove());
        if (recentEntry) recentEntry.style.display = 'none';
        const chipEl = document.getElementById('pageCard');
        const chipRect = chipEl ? chipEl.getBoundingClientRect() : null;
        const pageInfo = { title: chipEl ? chipEl.dataset.title : '', host: (chipEl && chipEl.dataset.host) || (ctx && ctx.host) || '' };
        const focus = ctx && ctx.focus ? T('Your focus question') : (ctx && ctx.highlights > 0 ? T('Your highlights · {n}', { n: ctx.highlights }) : '');
        const first = addFirstBubble(pageInfo, '', chipRect);
        if (focus) { const sub = document.createElement('div'); sub.className = 'chat-q-sub'; sub.textContent = focus; first.appendChild(sub); }
        addStreamBubble(document.getElementById('chipModelLabel')?.textContent || '', 'cloud');
        updateStream(T('Working on it…'));
        updateStreamProgress(10);
        getActiveTab().then(tab => { if (tab) activeTabId = tab.id; }).catch(() => {});
    };

    // ── Listen for streaming relay from content script ─────────────────
    // On Firefox a hybrid-sidebar iframe is downgraded to content-script
    // privileges, so it never receives runtime.sendMessage broadcasts. The
    // content script also postMessages directly into the iframe's document,
    // which needs no extension privileges — handle those here exactly like
    // the runtime broadcasts.
    let instant = null;
    try {
        const pill = document.querySelector('.composer-pill');
        instant = initInstantRead({ chip: document.getElementById('chipSound'), panel: document.getElementById('panelSound'), barHost: pill && pill.parentElement, });
    } catch (_) { /* reading aloud is optional */ }
    const handleStreamMessage = (msg) => {
        if (instant) { try { instant.onMessage(msg); } catch (_) { /* never block the stream */ } }
        if (msg.action === 'summaryContext' && composer && composer.state !== 'working') adoptRun(msg);
        if (msg.action === 'summaryProgress') {
            // Two quiet channels instead of one flickering line: a monotonic phase title and a word counter.
            const raw = String(msg.chunk || '');
            const wc = raw.match(/^(\d+) words/);
            if (wc) {
                streamPhase = 2;
                const st = document.getElementById('streamStats');
                if (st) st.textContent = TN(Number(wc[1]), '{n} word', '{n} words');
            } else if (/^Receiving data/i.test(raw)) {
                streamPhase = 2;
            } else if (/^(Connected|Waiting)/i.test(raw)) {
                streamPhase = Math.max(streamPhase, 1);
            }
            if (streamPhase !== lastStepPhase) { lastStepPhase = streamPhase; if (lastContext) renderSteps(lastContext); }
            const phaseTitle = ['', T('Waiting for the model…'), T('Writing the summary…')][streamPhase];
            if (phaseTitle) { if (phaseTitle !== lastPhaseTitle) { lastPhaseTitle = phaseTitle; updateStream(phaseTitle); } }
            else updateStream(raw || T('Working on it…'));
            if (msg.preview) updateStreamPreview(msg.preview);
            if (typeof msg.progress === 'number') updateStreamProgress(msg.progress);
        }
        if (msg.action === 'summaryContext') {
            setTimeout(syncWorkingButton, 0);   // the job is registered by now: is it this tab's?
            lastContext = { ...msg, model: document.getElementById('chipModelLabel')?.textContent || '' };
            renderSteps(lastContext);
        }
        if (msg.action === 'summarySaved') {
            if (msg.url && msg.id) savedIds[msg.url] = msg.id;
            if (liveBubbleArticle && msg.id && samePage(liveBubbleArticle.url, msg.url) && !liveBubbleArticle.id) {
                liveBubbleArticle.id = msg.id;
                try { liveBubbleEl && liveBubbleEl._decorate && liveBubbleEl._decorate(); } catch (_) { /* card gone */ }
            }
            if (conversation && msg.id && samePage(conversation.url, msg.url)) {
                conversation.id = msg.id;
                if (liveBubbleArticle) liveBubbleArticle.id = msg.id;   // so opening it shows the saved conversation
                persistConversation();    // turns asked before the save finished
            }
        }
        if (msg.action === 'summaryCancelled') {
            removeStreamBubble();
            lastContext = null;
            resetToFetch();
        }
        if (msg.action === 'summaryComplete') {
            removeStreamBubble();
            // Render the new summary immediately from relayed data
            if (msg.summary) {
                clearThread();
                const bubbleArticle = {
                    title: msg.title || 'Summary',
                    url: msg.url || '',
                    summary: msg.summary,
                    timestamp: msg.timestamp || new Date().toISOString(),
                    tags: msg.tags || [],
                    modelId: msg.modelId || '',
                    connectionMode: msg.connectionMode || 'local',
                    meta: msg.meta || {},
                    content: msg.content || ''
                };
                const liveBubble = addBubble(bubbleArticle);
                liveBubbleArticle = bubbleArticle; liveBubbleEl = liveBubble;
                if (savedIds[msg.url]) { bubbleArticle.id = savedIds[msg.url]; liveBubble._decorate(); }   // the save was confirmed before the card existed
                const used = usedRow(lastContext);
                if (used) {
                    const wrap = document.createElement('div');
                    wrap.className = 'sc-used-wrap';
                    wrap.appendChild(used);
                    feed.appendChild(wrap);
                }
                conversation = {
                    url: msg.url || '', title: msg.title || '', content: msg.content || '',
                    summary: msg.summary, meta: msg.meta || {}, turns: []
                };
                clearNote();
                const given = (Array.isArray(msg.questions) ? msg.questions : []).filter(Boolean);
                conversation.pool = given.slice();
                conversation.quick = (msg.quick && typeof msg.quick === 'object') ? { ...msg.quick } : {};
                renderSuggestions();
                if (composer) { composer.set('followup'); showConversationChip(); }
                scrollFeed();
            } else {
                resetToFetch();
            }
        }
        if (msg.action === 'summaryError') {
            updateStream('❌ ' + (msg.error || 'Something went wrong'));
            // Ollama can't be reached / rejects the extension origin (HTTP 403 = OLLAMA_ORIGINS):
            // keep the bubble and point to the setup guide in Settings instead of vanishing.
            const errText = String(msg.error || '');
            const looksLikeOllama = /HTTP (403|404|0)\b|Failed to fetch|NetworkError|Load failed|ECONNREFUSED|ERR_CONNECTION/i.test(errText);
            const ollamaHint = looksLikeOllama ? Promise.all([
                chrome.storage.sync.get(['connectionMode', 'activeService'])
            ]).then(([s]) => s.connectionMode === 'local' && s.activeService === 'ollama').catch(() => false) : Promise.resolve(false);
            ollamaHint.then((isOllama) => {
                if (isOllama) {
                    const bubble = document.getElementById('streamBubble');
                    if (bubble && !bubble.querySelector('.ollama-hint')) {
                        const hint = document.createElement('div');
                        hint.className = 'ollama-hint';
                        hint.setAttribute('role', 'alert');
                        hint.innerHTML = '<div class="ollama-hint-text"></div><button type="button" class="button-secondary ollama-hint-btn"></button>';
                        hint.querySelector('.ollama-hint-text').textContent = /403/.test(errText)
                            ? T('Ollama refused the request. A 403 usually means it must be told to accept requests from this extension (OLLAMA_ORIGINS).')
                            : T('Could not reach Ollama. Make sure it is running and the endpoint is correct.');
                        const btn = hint.querySelector('.ollama-hint-btn');
                        btn.textContent = T('Set up Ollama') + ' →';
                        btn.addEventListener('click', () => {
                            if (ui && typeof ui.showScreen === 'function') {
                                ui.showScreen('settings');
                                import('./settingsNav.js').then(m => m.openSettingsPanel('models')).catch(() => {});
                            }
                        });
                        bubble.appendChild(hint);
                    }
                    if (fetchSummaryButton) resetToFetch();
                    return;
                }
                // Setup problems (missing/invalid API key, not logged in, plan limit): keep the bubble and link to the right settings panel.
                const panel = /API key|invalid.*key|incorrect.*key|HTTP 40[13]\b|unauthori[sz]ed/i.test(errText) ? 'models'
                    : /log ?in|sign ?in|token|licen[sc]e|daily limit|upgrade|HTTP (402|429)\b/i.test(errText) ? 'account' : '';
                if (panel) {
                    const bubble = document.getElementById('streamBubble');
                    if (bubble && !bubble.querySelector('.ollama-hint')) {
                        const hint = document.createElement('div');
                        hint.className = 'ollama-hint';
                        hint.setAttribute('role', 'alert');
                        hint.innerHTML = '<div class="ollama-hint-text"></div><button type="button" class="button-secondary ollama-hint-btn"></button>';
                        hint.querySelector('.ollama-hint-text').textContent = panel === 'models'
                            ? T('Your API key is missing or was rejected. Check it in the settings.')
                            : T('This needs your account. Log in or check your plan in the settings.');
                        const btn = hint.querySelector('.ollama-hint-btn');
                        btn.textContent = (panel === 'models' ? T('Open model settings') : T('Open account settings')) + ' →';
                        btn.addEventListener('click', () => {
                            if (ui && typeof ui.showScreen === 'function') {
                                ui.showScreen('settings');
                                import('./settingsNav.js').then(m => m.openSettingsPanel(panel === 'models' ? 'models' : 'account')).catch(() => {});
                            }
                        });
                        bubble.appendChild(hint);
                    }
                    if (fetchSummaryButton) resetToFetch();
                    return;
                }
                if (fetchSummaryButton) {
                    setTimeout(() => {
                        resetToFetch();
                        removeStreamBubble();
                    }, 3000);
                }
            });
        }
    };

    chrome.runtime.onMessage.addListener(handleStreamMessage);

    // Panel opened while a summary is already running (started from the page): catch up.
    getActiveTab().then(tab => (tab && tab.id != null && isInjectableUrl(tab.url)) ? sendMessageToTab(tab.id, { action: 'getSummaryState' }) : null)
        .then(st => {
            if (st && st.running && st.context) {
                handleStreamMessage(st.context);
                if (st.progress) handleStreamMessage(st.progress);
            }
        }).catch(() => {});

    // Hybrid-sidebar iframe return path (Firefox): the content script
    // postMessages the same streaming events directly into our document
    // because runtime.sendMessage broadcasts can't reach a downgraded
    // iframe. Normalize those events and feed them through the same handler.
    // popup.html is web-accessible, so any site can frame it and post to it: accept only events from the page
    // that embeds us carrying the token our content script put in the #hash (sidebarChannel.js).
    const sidebarToken = sidebarTokenFromHash(window.location.hash);
    window.addEventListener('message', (event) => {
        if (!acceptSidebarMessage(event, sidebarToken, window.parent, window)) return;
        const { [SIDEBAR_TOKEN_FIELD]: _token, ...data } = event.data;
        handleStreamMessage(data);
    });

    // ── Save only (no AI) ───────────────────────────────────────────────
    const saveMenuBtn = document.getElementById('saveMenuBtn');
    const savePageOnly = async () => {
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        if (!tab || !tab.url || !isInjectableUrl(tab.url)) { if (ui && ui.showToast) ui.showToast(T('This page can\'t be saved.')); return; }
        let res = null;
        try { res = await sendMessageToTab(tab.id, { action: 'savePage' }); } catch (_) { /* handled below */ }
        if (!res || !res.success) { if (ui && ui.showToast) ui.showToast(T('Could not save this page — try refreshing the tab.')); return; }
        const { undoToast } = await import('./sendSheet.js');
        const id = res.id;
        undoToast(T('📥 Saved without AI'), async () => {
            const { [SK.articlesIndex]: idx = [] } = await StorageManager.getLocal({ [SK.articlesIndex]: [] });
            await StorageManager.setLocal({ [SK.articlesIndex]: idx.filter(a => a.id !== id) });
            try { await new Promise(r => chrome.storage.local.remove([articleRecKey(id)], r)); } catch (_) { /* ignore */ }
        });
    };
    if (saveMenuBtn) {
        let menu = null;
        const closeMenu = () => { if (menu) { menu.remove(); menu = null; } saveMenuBtn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true); };
        const onOutside = (e) => { if (menu && !menu.contains(e.target) && !saveMenuBtn.contains(e.target)) closeMenu(); };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); saveMenuBtn.focus(); } };
        const openMenu = () => {
            menu = document.createElement('div');
            menu.className = 'card-menu save-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', T('Save options'));
            const mk = (icon, label, hint, fn) => {
                const b = document.createElement('button'); b.type = 'button'; b.className = 'card-menu-item'; b.setAttribute('role', 'menuitem');
                const ic = document.createElement('span'); ic.className = 'card-menu-ic'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = icon;
                const tx = document.createElement('span'); tx.className = 'save-menu-txt'; tx.textContent = label;
                const sm = document.createElement('small'); sm.textContent = hint; tx.append(sm);
                b.append(ic, tx);
                b.addEventListener('click', () => { closeMenu(); fn(); });
                return b;
            };
            menu.append(
                mk('✨', T('Summarize'), T('Read it with AI'), () => fetchSummaryButton.click()),
                mk('📥', T('Save only'), T('Keep it in History, no AI, nothing sent'), savePageOnly)
            );
            document.body.append(menu);
            const r = saveMenuBtn.getBoundingClientRect();
            const mh = menu.offsetHeight, mw = menu.offsetWidth;
            menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
            menu.style.top = Math.max(8, r.top - mh - 8) + 'px';
            saveMenuBtn.setAttribute('aria-expanded', 'true');
            document.addEventListener('pointerdown', onOutside, true);
            document.addEventListener('keydown', onKey, true);
            const first = menu.querySelector('button'); if (first) first.focus();
            menu.addEventListener('keydown', (e) => {
                const items = [...menu.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
                if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
            });
        };
        saveMenuBtn.addEventListener('click', () => { if (menu) closeMenu(); else openMenu(); });
        // Alt/Option + Enter in the box = save only
        additionalQuestionsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.altKey && !e.isComposing && composer && composer.state === 'fetch') { e.preventDefault(); savePageOnly(); }
        });
    }

    // ── Summary queue ───────────────────────────────────────────────────
    // The background keeps one summary running at a time; asking for another one (on this or another tab, or from
    // Feeds) puts it in line. The note below stays until that job starts or is removed.
    const bgSend = (m) => new Promise((resolve) => { try { chrome.runtime.sendMessage(m, (r) => { void chrome.runtime.lastError; resolve(r || null); }); } catch (_) { resolve(null); } });
    const queueNotes = new Map();   // job id -> element
    const showQueuedNote = (id, title, position) => {
        queueNotes.get(id)?.remove();
        const el = document.createElement('div');
        el.className = 'queue-note'; el.setAttribute('role', 'status');
        const txt = document.createElement('span');
        txt.textContent = '⏳ ' + T('Queued: {title}', { title: clip(title || T('this page'), 60) }) + (position > 1 ? ' · #' + position : '') + ' — ' + T('starts when the current summary is done');
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'button-secondary btn-sm'; rm.textContent = T('Remove');
        rm.addEventListener('click', () => { bgSend({ action: 'cancelQueuedSummary', id }); el.remove(); queueNotes.delete(id); });
        el.append(txt, rm); feed.appendChild(el); queueNotes.set(id, el); scrollFeed();
    };
    const onQueueUpdate = (msg) => {
        if (!msg || msg.action !== 'summaryQueue') return;
        const live = new Set((msg.queue || []).map(j => j.id));
        for (const [id, el] of queueNotes) if (!live.has(id)) { el.remove(); queueNotes.delete(id); }
        syncWorkingButton();
    };
    chrome.runtime.onMessage.addListener(onQueueUpdate);

    // ── Fetch button ────────────────────────────────────────────────────
    fetchSummaryButton.addEventListener('click', async () => {
        if (composer && composer.state === 'working' && !workingElsewhere) {      // Stop
            if (activeTabId != null) sendMessageToTab(activeTabId, { action: 'stopSummary' }).catch(() => {});
            return;
        }
        if (composer && composer.state === 'followup') {     // Send follow-up
            const q = additionalQuestionsInput.value.trim();
            if (q) sendFollowUp(q);
            return;
        }
        const additionalQuestions = additionalQuestionsInput.value;
        const chipEl = document.getElementById('pageCard');
        const chipRect = chipEl ? chipEl.getBoundingClientRect() : null;
        const pageInfo = chipEl ? { title: chipEl.dataset.title, host: chipEl.dataset.host } : null;
        const selectedLanguage = languageSelect.value;

        chrome.storage.sync.get(['prompt', 'promptType', 'presetPrompt'], async (data) => {
            let promptToUse = data.prompt || '';

            const { [SK.summaryMode]: summaryMode } = await chrome.storage.local.get(SK.summaryMode);
            if (attaching) return;                                          // still reading the file
            const attachment = attached ? { name: attached.name, html: attached.html, text: attached.text } : null;
            const mode = attachment ? 'extension' : (summaryMode || 'extension');   // an attached PDF is always shown in the panel
            const buildMessage = async () => {
                const { connectionMode = 'cloud', preferredCloudModel = 'google/gemini-3.8-flash' } = await chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']);
                return {
                    action: 'fetchSummary',
                    additionalQuestions,
                    selectedLanguage,
                    prompt: promptToUse,
                    summaryMode: mode,
                    summaryLength: await currentLengthSpec(SK),
                    connectionMode,
                    preferredCloudModel,
                    ...(attachment ? { attachment } : {}),
                };
            };

            // Another summary is running → line this one up instead of starting a second stream.
            if (mode === 'extension' && !attachment) {
                const jobs = await bgSend({ action: 'summaryJobs' });
                if (jobs && jobs.running) {
                    try {
                        const tab = await getActiveTab();
                        if (tab && tab.id != null && (await hasSiteAccess(tab.url))) {
                            await ensureContentScript(tab.id, tab.url);
                            const r = await bgSend({ action: 'queueSummary', tabId: tab.id, url: tab.url, title: pageInfo && pageInfo.title || tab.title || '', message: await buildMessage() });
                            if (r && r.queued) { additionalQuestionsInput.value = ''; showQueuedNote(r.id, pageInfo && pageInfo.title || tab.title, r.position); return; }
                            if (r && r.ok) { return; }   // the other summary ended meanwhile: it started right away
                        }
                    } catch (_) { /* fall through to the normal path */ }
                }
            }

            if (mode === 'extension' && composer) {
                composer.set('working');
                additionalQuestionsInput.value = '';   // the focus question is on its way; the box is free for the next question
                clearNote();
                feed.querySelectorAll('.chat-turn, .chat-turn-group, .sc-used-wrap, .chat-suggest').forEach(n => n.remove());
            } else {
                fetchSummaryButton.disabled = true;
                fetchSummaryButton.textContent = '⏳ Summarizing…';
            }

            if (mode === 'extension') {
                // Show the streaming bubble and hide the welcome entry
                if (recentEntry) recentEntry.style.display = 'none';
                const modelLabel = document.getElementById('chipModelLabel');
                const chipIcon = document.querySelector('.chip[data-panel="model"] .chip-icon');
                const isCloud = chipIcon?.textContent === '☁️' || ((await chrome.storage.sync.get('connectionMode')).connectionMode || 'cloud') === 'cloud';
                
                addFirstBubble(pageInfo, additionalQuestions, chipRect);
                addStreamBubble(modelLabel?.textContent || '', isCloud ? 'cloud' : 'local');
                updateStream('Contacting content script…');
                // Show the bar immediately on click rather than waiting for
                // the content script's own progress relay to arrive — that
                // relay can be delayed by page content extraction/injection,
                // which is exactly what made the bar look like it only
                // appeared once real content started streaming in.
                updateStreamProgress(10);
            }

            try {
                const activeTab = await getActiveTab();
                if (!activeTab) {
                    updateStream('❌ No active tab found');
                    resetToFetch();
                    return;
                }

                // Safari opt-in model: if we don't yet have access to this site,
                // request it NOW — still within the click gesture, so Safari's
                // native "Allow on this website?" prompt is honored. This avoids
                // the silent PING timeout that happens when access was never
                // granted in the first place.
                if (!(await hasSiteAccess(activeTab.url))) {
                    const granted = await requestSiteAccess(activeTab.url);
                    if (!granted) {
                        updateStream('❌ AI Summary Helper needs permission to run on this site. Please tap "Allow" in the prompt (or enable it in Safari Settings → Extensions → AI Summary Helper).');
                        resetToFetch();
                        return;
                    }
                }

                activeTabId = activeTab.id;
                await ensureContentScript(activeTab.id, activeTab.url);
                if (attachment) {   // a tab opened before the extension was updated still runs the old script, which would summarize the page instead
                    let caps = [];
                    try { const r = await sendMessageToTab(activeTab.id, { action: 'ping' }); caps = (r && r.caps) || []; } catch (_) { /* treated as old */ }
                    if (!caps.includes('attachment')) {
                        updateStream('❌ ' + T('This tab still runs an older version of the extension. Reload the tab (F5) and try again.'));
                        resetToFetch();
                        return;
                    }
                }

                const message = await buildMessage();

                try {
                    if (mode === 'extension' && !attachment) {
                        // Through the job queue, so a second request (other tab, Feeds) waits for this one.
                        const r = await bgSend({ action: 'queueSummary', tabId: activeTab.id, url: activeTab.url, title: pageInfo && pageInfo.title || activeTab.title || '', message });
                        if (r && r.queued) {   // another summary started in the meantime: undo the progress UI and wait in line
                            removeStreamBubble();
                            feed.querySelectorAll('.chat-turn, .chat-turn-group').forEach(n => n.remove());
                            resetToFetch();
                            showQueuedNote(r.id, pageInfo && pageInfo.title || activeTab.title, r.position);
                            return;
                        }
                        if (!r || !r.ok) await sendMessageToTab(activeTab.id, message);   // background unreachable: start directly
                    } else {
                        await sendMessageToTab(activeTab.id, message);
                    }
                    if (attachment) { attached = null; attachError = ''; }
                } catch (err) {
                    console.warn("Popup communication error:", err);
                    updateStream('❌ Could not reach page — try refreshing the tab.');
                    resetToFetch();
                }

                // Inline mode: close popup
                if (mode !== 'extension') {
                    setTimeout(() => window.close(), 100);
                }
            } catch (err) {
                console.error('Failed to communicate with tab:', err);
                // Give a clearer message for permission-related failures (e.g.
                // Safari "Ask" permission not granted for this site).
                const msg = (err && err.message) || '';
                // If ensureContentScript already surfaced a full actionable
                // permission message, don't append a redundant short hint.
                const alreadyActionable = /Safari Settings|Always Allow|Allow on this website/i.test(msg);
                const permissionHint = !alreadyActionable && /permission|not allowed|Cannot access|inject/i.test(msg)
                    ? ' — allow this extension on this site (Safari: tap the icon → Always Allow).'
                    : '';
                updateStream('❌ ' + msg + permissionHint);
                resetToFetch();
            }
        });
    });
}

// ── Onboarding extras ────────────────────────────────────────────────
// The email/OTP login flow itself is wired once, globally, by the shared
// authManager module (see initAuthManager in popup.js / settingsManager.js)
// — it drives both the onboarding mask's inputs and the Settings screen's
// "Account Sync" panel from one implementation. All that's left for
// mainScreen.js to wire up here is the onboarding wording and the two
// no-account choices (own API key, Ollama), which open the model settings
// with the matching tab selected.
function setupOnboardingExtras(ui) {
    const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
    set('onboardingHeading', T('How should AI Summary Helper think?'));
    set('onboardingIntro', T('Pick one. You can change it any time in the model settings, and nothing is sent anywhere until you summarize a page.'));
    set('onboardingOwnKeyTitle', '🔑 ' + T('My own API key'));
    set('onboardingOwnKeyHint', T('OpenAI, Gemini, Mistral, DeepSeek and more. No account, the key stays on this device.'));
    set('onboardingOllamaTitle', '🦙 ' + T('Ollama on this computer'));
    set('onboardingOllamaHint', T('Local models. No account, no key, nothing leaves your machine.'));
    const mac = /Mac|iPhone|iPad/i.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));
    set('onboardingTip', T('Tip: press {key} on any page to summarize it.', { key: mac ? '⌘ + Shift + E' : 'Ctrl + Shift + E' }));

    // Own key / Ollama: open the model settings with the matching tab already selected.
    const openModels = (radioId) => {
        if (!(ui && typeof ui.showScreen === 'function')) return;
        ui.showScreen('settings');
        import('./settingsNav.js').then((m) => {
            m.openSettingsPanel('models');
            setTimeout(() => {
                const r = document.getElementById(radioId);
                if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
            }, 60);
        }).catch(() => {});
    };
    const bind = (id, radioId) => {
        const btn = document.getElementById(id);
        if (btn && !btn.dataset.bound) { btn.dataset.bound = 'true'; btn.addEventListener('click', () => openModels(radioId)); }
    };
    bind('onboardingCustomApiBtn', 'modeLocal');
    bind('onboardingOllamaBtn', 'modeOllama');
}

// Helper to check if tab URL supports content scripts
function isInjectableUrl(url) {
  if (!url) return false;
  return !url.startsWith('chrome://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.includes('chrome.google.com/webstore');
}

// ── Tab helpers (Firefox hybrid-sidebar iframe fallback) ─────────────
// When popup.html is loaded inside an <iframe> embedded in a regular web
// page (the hybrid sidebar), Firefox downgrades that iframe to
// content-script-level privileges: `chrome.tabs` (and its `chrome.tabs`
// compatibility alias) is undefined there. These helpers try the direct
// call first — which works in the native popup and in Chrome's iframe —
// and transparently fall back to asking background.js, which always has
// full privileges on every platform.

/**
 * Resolve the active tab, or null if none. Falls back to background.js
 * when `chrome.tabs` is unavailable (Firefox hybrid-sidebar iframe).
 */
export function getActiveTab() {
    if (typeof chrome.tabs?.query === 'function') {
        return chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs && tabs[0]);
    }
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getActiveTab' }, (res) => {
            if (chrome.runtime.lastError || !res?.success) {
                resolve(null);
                return;
            }
            resolve(res.tab);
        });
    });
}

/**
 * Send a message to a tab, resolving with the response. Falls back to
 * background.js when `chrome.tabs` is unavailable. Rejects on error.
 */
// Pages run only a tiny loader (loader.js); the full content script is injected the first time we talk to the page.
// ping / stopSummary / getSummaryState are probes and must not inject.
const NO_INJECT = new Set(['ping', 'stopSummary', 'getSummaryState']);
const NOT_THERE = /Receiving end does not exist|Could not establish connection|No matching message handler/i;
export function sendMessageToTab(tabId, message, _retried = false) {
    return new Promise((resolve, reject) => {
        if (typeof chrome.tabs?.sendMessage === 'function') {
            chrome.tabs.sendMessage(tabId, message, async (response) => {
                if (chrome.runtime.lastError) {
                    const err = chrome.runtime.lastError;
                    if (!_retried && message && !NO_INJECT.has(message.action) && NOT_THERE.test(err.message || '') && chrome.scripting?.executeScript) {
                        try {
                            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
                            resolve(await sendMessageToTab(tabId, message, true));
                            return;
                        } catch (_) { /* restricted page: report the original error */ }
                    }
                    reject(err);
                    return;
                }
                resolve(response);
            });
        } else {
            chrome.runtime.sendMessage({ action: 'relayToActiveTab', message }, (res) => {
                if (chrome.runtime.lastError || !res?.success) {
                    reject(new Error((res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Could not reach page'));
                    return;
                }
                resolve(res.response);
            });
        }
    });
}

// ── Site-access permission helpers (Safari opt-in model) ─────────────
// Safari (macOS + iOS) treats website access as opt-in per site, unlike
// Chrome/Firefox which grant <all_urls> at install time. These helpers use
// the official `chrome.permissions` API to check and request access, which
// shows Safari's native "Allow on this website?" prompt.

/**
 * Check whether the extension currently has access to a given origin.
 * Returns true if the API is unavailable (falls through to injection).
 */
export function hasSiteAccess(url) {
    return new Promise((resolve) => {
        if (typeof chrome.permissions?.contains !== 'function') {
            resolve(true);
            return;
        }
        try {
            chrome.permissions.contains({ origins: [url] }, (result) => {
                if (chrome.runtime.lastError) {
                    resolve(true);
                    return;
                }
                resolve(!!result);
            });
        } catch (e) {
            resolve(true);
        }
    });
}

/**
 * Request access to a given origin via Safari's native permission prompt.
 * MUST be called from within a user gesture (e.g. a click handler) for
 * Safari/Chrome to honor it. Returns true if granted.
 */
export function requestSiteAccess(url) {
    return new Promise((resolve) => {
        if (typeof chrome.permissions?.request !== 'function') {
            resolve(false);
            return;
        }
        try {
            chrome.permissions.request({ origins: [url] }, (granted) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(!!granted);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

// Helper to check if content script is loaded, or inject it if not
export async function ensureContentScript(tabId, url) {
    // Restricted Chrome URLs
    if (!isInjectableUrl(url)) {
        throw new Error('AI Summary cannot run on system pages or the Web Store.');
    }

    // Try a ping first — if it succeeds we're already good
    const ping = async (id) => {
        try {
            const res = await sendMessageToTab(id, { action: 'ping' });
            const status = (res && res.status || '').toLowerCase();
            return status === 'pong';
        } catch (e) {
            return false;
        }
    };

    if (await ping(tabId)) return; // already loaded

    // Proactively check whether we're allowed to run scripts on this page.
    // Safari (macOS + iOS) treats website access as opt-in per site, so even
    // though the manifest requests <all_urls>, the user must grant access.
    // If not granted, both static injection AND executeScript fail closed
    // with no error surfaced — so detect it here and prompt accordingly.
    const hasAccess = await hasSiteAccess(url);

    if (!hasAccess) {
        throw new Error(
            'AI Summary Helper does not have permission to run on this site. ' +
            'Please enable it in Safari Settings → Extensions → AI Summary Helper ' +
            '→ "Allow on this website" (or "Always Allow on every website").'
        );
    }

    // Content script not present — inject it
    debug('Injecting content script due to ping failure...');
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (e) {
        console.error('ExecuteScript error:', e);
        const msg = (e && e.message) || '';
        // Safari surfaces permission failures here (e.g. "This extension does
        // not have permission to run scripts on this page").
        if (/permission|not allowed|Cannot access|not permitted|denied/i.test(msg)) {
            throw new Error(
                'AI Summary Helper does not have permission to run on this site. ' +
                'Please enable it in Safari Settings → Extensions → AI Summary Helper ' +
                '→ "Allow on this website" (or "Always Allow on every website").'
            );
        }
        throw new Error('Failed to inject script: ' + msg);
    }

    // Poll with PINGs for up to ~3 seconds (30 × 100ms) to wait for content.js
    // to finish parsing and register its onMessage listener. iOS/Safari can be
    // slow to initialize a large content script, so give it more time.
    for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (await ping(tabId)) return;
    }

    throw new Error('Content script loaded but failed to respond to PING.');
}
