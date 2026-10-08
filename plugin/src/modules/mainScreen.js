import { SK } from './storageKeys.js';
import { debug } from './log.js';
// mainScreen.js
// Handles main screen UI — chat-style summary feed

import StorageManager from './storageManager.js';
import { T, TN } from './feedI18n.js';
import { aiComplete } from './feedAi.js';
import { createComposer, samePage, contextRows, statusLines } from './composerState.js';
import { answerPreview, newTurn, buildPrompt, parseAnswer, buildSuggestPrompt, parseSuggestions } from './conversation.js';
import { turnEl, renderAnswer } from './qaView.js';

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
        const tagsHtml = tags.length ? `<div class="bubble-tags">${tags.map(t => `<span class="bubble-tag">${t}</span>`).join('')}</div>` : '';
        const modelEmoji = article.connectionMode === 'cloud' ? '☁️' : '💻';
        const modelHtml = article.modelId ? `<span style="font-size:10px;opacity:0.5;margin-top:4px;display:block;">${modelEmoji} ${article.modelId}</span>` : '';
        const bubble = document.createElement('div');
        bubble.className = 'summary-bubble';
        bubble.innerHTML = `
            <div class="summary-bubble-header">
                <span class="summary-bubble-title">${title.length > 50 ? title.slice(0, 50) + '…' : title}</span>
                <span class="summary-bubble-domain">${domain} · ${date}</span>
            </div>
            <div class="summary-bubble-body">${preview}</div>
            ${tagsHtml}
            ${modelHtml}
        `;
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
        feed.appendChild(bubble);
    };

    // Tracks the highest % shown so far in the current streaming session —
    // updateStreamProgress() uses it to ignore any out-of-order/lower update
    // (e.g. a delayed "connecting" message arriving after streaming has
    // already moved the bar further along), so the bar only ever advances.
    let lastShownStreamProgress = 0;
    let streamPhase = 0;          // 0 starting · 1 waiting for the model · 2 writing (never goes back)
    let lastPhaseTitle = '';

    const addStreamBubble = (modelName = '', mode = 'local') => {
        // Remove any existing stream bubble
        const old = feed.querySelector('.stream-bubble');
        if (old) old.remove();
        lastShownStreamProgress = 0;
        streamPhase = 0; lastPhaseTitle = '';

        const emoji = mode === 'cloud' ? '☁️' : '💻';
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
            const scrollEl = document.getElementById('feedScroll');
            if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
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
    let liveBubbleArticle = null;     // the article object behind the newest bubble
    const bar = document.querySelector('.controls-bar');

    const esc = (x) => String(x || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const usedOpen = () => { try { return localStorage.getItem('aish:usedOpen') === '1'; } catch (_) { return false; } };
    const setUsedOpen = (v) => { try { localStorage.setItem('aish:usedOpen', v ? '1' : '0'); } catch (_) { /* storage unavailable */ } };
    const scrollFeed = () => requestAnimationFrame(() => {
        const el = document.getElementById('feedScroll');
        if (el) el.scrollTop = el.scrollHeight;
    });

    const renderSteps = (ctx) => {
        const ul = document.getElementById('streamSteps');
        if (!ul) return;
        ul.innerHTML = statusLines(ctx).map((l, i, all) =>
            `<li class="${i === all.length - 1 ? 'sc-step sc-step--now' : 'sc-step'}">${esc(l)}</li>`).join('');
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
        return det;
    };

    const composer = createComposer(bar, {
        onChange: (next) => {
            additionalQuestionsInput.style.height = '';
            if (next === 'fetch') refreshFetchExtras(); else clearNote();
            if (next === 'followup') showConversationChip();
            if (next === 'followup' && additionalQuestionsInput.value.trim()) sendFollowUp(additionalQuestionsInput.value.trim());
        }
    });
    additionalQuestionsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && composer && composer.state === 'followup') {
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

    // Fetch state extras: the page in the active tab as a chip INSIDE the input card (it flies into the thread on Fetch),
    // and the last summary as a resume card at the end of the feed.
    let extrasToken = 0;
    const clip = (x, n) => { x = String(x || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
    const clearNote = () => {
        extrasToken++;
        document.getElementById('pageCard')?.remove();
        document.getElementById('convChip')?.remove();
        document.getElementById('resumeCard')?.remove();
    };
    const latestArticle = async () => {
        try {
            const idx = await StorageManager.getArticlesIndex();
            return idx.slice().sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))[0] || null;
        } catch (_) { return null; }
    };
    const refreshFetchExtras = async () => {
        clearNote();
        const token = extrasToken;
        if (!composer || composer.state !== 'fetch' || !bar) return;
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        const latest = conversation ? null : await latestArticle();
        if (token !== extrasToken || composer.state !== 'fetch') return;
        const inputCard = bar.querySelector('.input-card');
        if (tab && tab.url && isInjectableUrl(tab.url) && inputCard) {
            const different = !!conversation && !samePage(conversation.url, tab.url);
            const chip = document.createElement('div');
            chip.id = 'pageCard';
            chip.className = 'page-chip' + (different ? ' page-chip--different' : '');
            chip.dataset.title = tab.title || ''; chip.dataset.host = hostOf(tab.url);
            if (tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl)) {
                const ic = document.createElement('img'); ic.className = 'page-chip-ic'; ic.alt = ''; ic.src = tab.favIconUrl;
                ic.addEventListener('error', () => ic.remove());
                chip.appendChild(ic);
            }
            const txt = document.createElement('div'); txt.className = 'page-chip-txt';
            const title = document.createElement('div'); title.className = 'page-chip-title'; title.textContent = clip(tab.title || chip.dataset.host, 80);
            const meta = document.createElement('div'); meta.className = 'page-chip-meta';
            meta.textContent = (different ? T('different page') + ' · ' : '') + chip.dataset.host;
            txt.append(title, meta);
            chip.appendChild(txt);
            inputCard.insertBefore(chip, inputCard.querySelector('.chip-row'));
        }
        const target = conversation
            ? { title: conversation.title, n: conversation.turns.length }
            : (latest ? { title: latest.title, n: latest.qaCount || 0, latest } : null);
        if (target) {
            const card = document.createElement('button');
            card.type = 'button'; card.id = 'resumeCard'; card.className = 'resume-card';
            const ic = document.createElement('span'); ic.className = 'resume-card-ic'; ic.textContent = '✨';
            const txt = document.createElement('span'); txt.className = 'resume-card-txt';
            const t = document.createElement('span'); t.className = 'resume-card-title'; t.textContent = clip(target.title || T('Summary'), 90);
            const m = document.createElement('span'); m.className = 'resume-card-meta';
            m.textContent = [T('Last summary'), target.n ? TN(target.n, '{n} follow-up', '{n} follow-ups') : '', T('Resume') + ' ›'].filter(Boolean).join(' · ');
            txt.append(t, m); card.append(ic, txt);
            card.addEventListener('click', () => resumeConversation(target.latest));
            feed.appendChild(card);
            scrollFeed();
        }
    };

    /** Follow-up state: the page the conversation is about, inside the input card (also for a resumed old summary). */
    const showConversationChip = () => {
        const inputCard = bar && bar.querySelector('.input-card');
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
        inputCard.insertBefore(chip, inputCard.querySelector('.chip-row'));
    };

    /** The page chip leaves the input card and lands as the first bubble of the thread (FLIP). */
    const flyIn = (el, from) => {
        if (!from || typeof el.animate !== 'function') return;
        try {
            const scroller = document.getElementById('feedScroll');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
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

    /** Back into a conversation: the in-memory one, or the stored one of a past summary. */
    const resumeConversation = async (articleEntry) => {
        if (!composer || composer.state === 'working') return;
        if (!conversation) {
            if (!articleEntry || !articleEntry.id) return;
            const full = await StorageManager.getArticleFull(articleEntry.id);
            conversation = {
                id: full.id, url: full.url || '', title: full.title || '', content: full.content || '', summary: full.summary || '',
                meta: full.meta || (full.favicon ? { favicon: full.favicon } : {}),
                turns: Array.isArray(full.conversation) ? full.conversation : []
            };
            feed.querySelectorAll('.chat-turn, .chat-turn-group, .sc-used-wrap, .chat-suggest').forEach(n => n.remove());
            conversation.turns.forEach(t => feed.appendChild(turnEl(t, { onPin: persistConversation, onSource: revealOnPage })));
        }
        let tab = null;
        try { tab = await getActiveTab(); } catch (_) { /* ignore */ }
        conversation.detached = !(tab && samePage(conversation.url, tab.url));   // resumed from another page: keep it open
        clearNote();
        composer.set('followup');
        scrollFeed();
    };

    /** Back to this page (chip button / ⌘N): back to the initial Fetch Summary state. Nothing is deleted — the summary is in History. */
    const startNew = () => {
        if (composer && composer.state === 'working') return;
        feed.querySelectorAll('.chat-turn, .chat-turn-group, .sc-used-wrap, .chat-suggest').forEach(n => n.remove());
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

    refreshFetchExtras();

    // Different-page rule: when the active tab is another page than the conversation, offer a fresh summary.
    const checkPage = async () => {
        if (!composer || composer.state === 'working') return;
        if (composer.state === 'fetch') { refreshFetchExtras(); return; }
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

    function addTurn(cls, text) {
        const el = document.createElement('div');
        el.className = `chat-turn ${cls}`;
        el.textContent = text;
        feed.appendChild(el);
        scrollFeed();
        return el;
    }

    const persistConversation = () => {
        if (conversation && conversation.id) StorageManager.saveConversation(conversation.id, conversation.turns).catch(() => {});
    };

    const revealOnPage = (quote, chip) => {
        if (!conversation || activeTabId == null) return;
        getActiveTab().then(tab => {
            if (!tab || !samePage(conversation.url, tab.url)) { chip.title = T('Open the page to jump to this passage') + ' — ' + quote; return; }
            sendMessageToTab(tab.id, { action: 'revealQuote', quote }).catch(() => {});
        }).catch(() => {});
    };

    async function sendFollowUp(q) {
        if (!conversation || !q) return;
        feed.querySelector('.chat-suggest')?.remove();
        additionalQuestionsInput.value = '';
        fetchSummaryButton.disabled = true;
        const qEl = addTurn('chat-q', q);
        const ans = addTurn('chat-a chat-a--pending', T('Thinking…'));
        try {
            const { system, user } = buildPrompt({ ...conversation, question: q });
            const raw = await aiComplete(system, user, null, null, (m) => {
                // Stream the answer in as it is written (cleaned of HTML / code fences / the SOURCES line).
                const t = m && m.text ? answerPreview(m.text) : '';
                if (t) { renderAnswer(ans, t); scrollFeed(); }
            }, { partial: true });
            const { a, sources } = parseAnswer(raw, conversation.content);
            const turn = newTurn(conversation.turns, { q, a: a || T('No answer.'), sources });
            conversation.turns.push(turn);
            const el = turnEl(turn, { onPin: persistConversation, onSource: revealOnPage });
            qEl.remove(); ans.replaceWith(el);
            persistConversation();
        } catch (err) {
            ans.textContent = '❌ ' + ((err && err.message) || T('AI request failed'));
            ans.classList.remove('chat-a--pending');
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
                const scrollEl = document.getElementById('feedScroll');
                if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
            });
            try { refreshFetchExtras(); } catch (_) { /* composer not ready yet */ }
        } else {
            if (recentEntry) recentEntry.style.display = 'flex';
            if (recentTitle) recentTitle.textContent = 'No recent summaries';
            if (recentMeta) recentMeta.textContent = 'Summarize a page to see it here';
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
        const data = await StorageManager.getAll();
        const hasArticles = Array.isArray(data[SK.articlesIndex]) && data[SK.articlesIndex].length > 0;
        const isCloudAuthed = !!data[SK.token];
        // Keyless providers (e.g. Ollama) count as configured without an API key.
        let keyOptional = false;
        try { keyOptional = !!(await StorageManager.getServices()).find(s => s.id === data.activeService)?.apiKeyOptional; } catch (e) {}
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
    const handleStreamMessage = (msg) => {
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
            const phaseTitle = ['', T('Waiting for the model…'), T('Writing the summary…')][streamPhase];
            if (phaseTitle) { if (phaseTitle !== lastPhaseTitle) { lastPhaseTitle = phaseTitle; updateStream(phaseTitle); } }
            else updateStream(raw || T('Working on it…'));
            if (msg.preview) updateStreamPreview(msg.preview);
            if (typeof msg.progress === 'number') updateStreamProgress(msg.progress);
        }
        if (msg.action === 'summaryContext') {
            lastContext = { ...msg, model: document.getElementById('chipModelLabel')?.textContent || '' };
            renderSteps(lastContext);
        }
        if (msg.action === 'summarySaved') {
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
                addBubble(bubbleArticle);
                liveBubbleArticle = bubbleArticle;
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
                const sug = document.createElement('div');
                sug.className = 'chat-suggest';
                const fillSuggestions = (qs) => {
                    qs.slice(0, 3).forEach((q) => {
                        const c = document.createElement('button');
                        c.type = 'button'; c.className = 'chat-suggest-chip'; c.textContent = q;
                        c.addEventListener('click', () => sendFollowUp(q));
                        sug.appendChild(c);
                    });
                };
                const given = (Array.isArray(msg.questions) ? msg.questions : []).filter(Boolean);
                fillSuggestions(given);
                feed.appendChild(sug);
                if (!given.length) {
                    // The model did not include the QUESTIONS comment: ask for them separately (one short call).
                    const forConv = conversation;
                    const { system, user } = buildSuggestPrompt(forConv);
                    aiComplete(system, user).then((raw) => {
                        if (conversation !== forConv || forConv.turns.length || !sug.isConnected) return;
                        fillSuggestions(parseSuggestions(raw));
                        scrollFeed();
                    }).catch(() => { /* suggestions are optional */ });
                }
                if (composer) composer.set('followup');
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
    window.addEventListener('message', (event) => {
        // Accept messages from our own content script. We don't allowlist the
        // source origin because the iframe's parent page origin is variable —
        // but the payload shape must match our summary events exactly.
        const data = event?.data;
        if (data && typeof data === 'object' && data.action) {
            handleStreamMessage(data);
        }
    });

    // ── Fetch button ────────────────────────────────────────────────────
    fetchSummaryButton.addEventListener('click', async () => {
        if (composer && composer.state === 'working') {      // Stop
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
            const mode = summaryMode || 'extension';

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
                const isCloud = chipIcon?.textContent === '☁️' || (await chrome.storage.sync.get('connectionMode')).connectionMode === 'cloud';
                
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

                const {
                    connectionMode = 'cloud',
                    preferredCloudModel = 'google/gemini-3.8-flash'
                } = await chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']);

                const message = {
                    action: 'fetchSummary',
                    additionalQuestions,
                    selectedLanguage,
                    prompt: promptToUse,
                    summaryMode: mode,
                    summaryLength: await chrome.storage.local.get(SK.summaryLength).then(d => d[SK.summaryLength] || 200),
                    connectionMode,
                    preferredCloudModel,
                };

                try {
                    await sendMessageToTab(activeTab.id, message);
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
// mainScreen.js to wire up here is the onboarding-only "use my own API"
// fallback button.
function setupOnboardingExtras(ui) {
    const customApiBtn = document.getElementById('onboardingCustomApiBtn');
    if (customApiBtn && !customApiBtn.dataset.bound) {
        customApiBtn.dataset.bound = 'true';
        customApiBtn.addEventListener('click', () => {
            if (ui && typeof ui.showScreen === 'function') {
                ui.showScreen('settings');
                import('./settingsNav.js').then(m => m.openSettingsPanel('models')).catch(() => {});
            }
        });
    }
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
export function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        if (typeof chrome.tabs?.sendMessage === 'function') {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
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
