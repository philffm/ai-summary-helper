// content/speedRead.js — Speed-Read on the page (Figma AISH-036, variant C "Satz-Leser", variant A as full screen).
// The summary is written first (progress), then shown word by word with the sentence above the word; pausing opens the
// paragraph around it. At the end: show it as text, keep the page, or close the tab (5 s countdown, offered only in the
// end state, never while paused, hidden or after an error; any input stops it).
// Lives in an open shadow root with the app's design tokens (inPage.css, generated regions + component CSS).
// Names start with `sr` (the content-script bundle shares one scope).
import { RSVP_MIN_WPM, RSVP_MAX_WPM, RSVP_STEP_WPM, rsvpClampWpm, rsvpBuild, rsvpChunks, rsvpDelayMs, rsvpPivot, rsvpSecondsLeft, rsvpSentenceStart } from '../modules/rsvp.js';
import { DECISION_TIMEFRAMES } from '../modules/decisionTime.js';
import { i18nKey } from '../modules/i18nKey.js';

const SR_HOST_ID = 'aish-speedread-host';
const SR_COUNTDOWN_S = 5;

/** UI text in the browser's language (content scripts read _locales through chrome.i18n; English is the fallback). */
export function srT(en, vars) {
    let s = '';
    try { s = chrome.i18n.getMessage(i18nKey(en)); } catch (_) { /* no i18n in tests */ }
    s = s || en;
    return vars ? s.replace(/\{([a-z]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Summary HTML → text blocks in reading order ({ text, heading }). Paragraphs, list items and lines split by <br>
 *  become one block each (markdownToHtml writes "<h2>…</h2><br><br>text<br><br>- item<br>- item"). */
export function srBlocksFromHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const out = [];
    let buf = '';
    const flush = () => {
        const t = buf.replace(/\s+/g, ' ').trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '');
        if (t) out.push({ text: t, heading: false });
        buf = '';
    };
    const BLOCK = /^(p|li|ul|ol|div|blockquote|section|article|dd|dt|dl|pre|table|tr|td|th)$/;
    const walk = (el) => {
        for (const n of el.childNodes) {
            if (n.nodeType === 3) { buf += n.textContent; continue; }
            if (n.nodeType !== 1) continue;
            const tag = n.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style') continue;
            if (tag === 'br' || tag === 'hr') { flush(); continue; }
            if (/^h[1-6]$/.test(tag)) { flush(); const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ text: t, heading: true }); continue; }
            if (BLOCK.test(tag)) { flush(); walk(n); flush(); continue; }
            walk(n);   // inline (strong, em, a, mark, span …)
        }
    };
    walk(doc.body.firstElementChild);
    flush();
    return out;
}

let srActive = null;

/** Streamed summary text while it is being written (content.js calls this for every chunk). */
export function speedReadStream(text) { if (srActive) srActive.stream(text); }
export function speedReadIsOpen() { return !!srActive; }

/**
 * Open the reader in its "writing the summary" state. Returns { stream, read, error, destroy }.
 * opts: { title, settings, theme, reduceMotion, onCancel, onRetry, onSettings(patch), onReminder(timeframe), onCloseTab() }
 */
export function speedReadOpen(opts = {}) {
    if (srActive) srActive.destroy();
    srActive = srCreate(opts);
    return srActive;
}

function srEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function srButton(cls, label, act, aria) {
    const b = srEl('button', cls, label);
    b.type = 'button'; b.dataset.act = act;
    if (aria) b.setAttribute('aria-label', aria);
    return b;
}

function srCreate(opts) {
    const settings = { ...(opts.settings || {}) };
    let wpm = rsvpClampWpm(settings.wpm);
    const prevFocus = document.activeElement;
    const reduceMotion = !!opts.reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ── DOM ──
    const host = srEl('div'); host.id = SR_HOST_ID; host.setAttribute('data-aish-ui', '1');
    if (opts.theme && opts.theme !== 'system') host.dataset.theme = opts.theme;
    if (opts.reduceMotion) host.dataset.motion = 'reduce';
    const root = host.attachShadow({ mode: 'open' });
    const css = document.createElement('link'); css.rel = 'stylesheet';
    try { css.href = chrome.runtime.getURL('inPage.css'); } catch (_) { /* tests */ }
    const scrim = srEl('div', 'sr-scrim');
    const box = srEl('section', 'sr' + (settings.fullscreen ? ' sr--full' : ''));
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', srT('Speed-Read')); box.tabIndex = -1;
    const head = srEl('header', 'sr-head');
    const kicker = srEl('span', 'sr-kicker', srT('Speed-Read') + (opts.title ? ' · ' + opts.title : ''));
    const fullBtn = srButton('sr-icon', '⤢', 'full', srT('Full screen'));
    fullBtn.setAttribute('aria-pressed', String(!!settings.fullscreen));
    const closeBtn = srButton('sr-icon', '✕', 'close', srT('Close'));
    head.append(kicker, srEl('span', 'sr-sp'), fullBtn, closeBtn);
    const body = srEl('div', 'sr-body');
    const foot = srEl('footer', 'sr-foot');
    const live = srEl('div', 'sr-only'); live.setAttribute('aria-live', 'polite');
    box.append(head, body, foot, live);
    root.append(css, scrim, box);
    (document.body || document.documentElement).appendChild(host);
    // the reader is shown once its styles are in (no flash of unstyled controls); without them after 1.5 s anyway
    let shown = false;
    const show = () => { if (!shown) { shown = true; host.classList.add('sr-ready'); box.focus({ preventScroll: true }); } };
    css.addEventListener('load', show); css.addEventListener('error', show); setTimeout(show, 1500);

    let state = 'writing', streamed = '', words = [], sentences = [], paragraphs = [], chunks = [], at = 0, timer = null, started = 0;
    let countdown = null, countdownLeft = 0, reminder = settings.reminder || 'none', destroyed = false, blocks = [];
    const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

    // ── states ──
    function renderWriting() {
        body.replaceChildren();
        const wrap = srEl('div', 'sr-status');
        wrap.append(srEl('p', 'sr-status-title', srT('Writing the summary …')));
        const n = streamed.split(/\s+/).filter(Boolean).length;
        wrap.append(srEl('p', 'sr-status-meta', n ? srT('{n} words so far', { n }) : srT('Reading starts as soon as it is done.')));
        const bar = srEl('div', 'sr-bar sr-bar--busy'); bar.append(srEl('span', 'sr-bar-fill'));
        wrap.append(bar);
        body.append(wrap);
        foot.replaceChildren(srEl('span', 'sr-hint', srT('Esc stops – the article is still saved.')));
    }

    function stream(text) {
        if (state !== 'writing') return;
        streamed = String(text || '');
        const meta = body.querySelector('.sr-status-meta');
        const n = streamed.split(/\s+/).filter(Boolean).length;
        if (meta && n) meta.textContent = srT('{n} words so far', { n });
    }

    function read(article) {
        if (destroyed) return;
        blocks = srBlocksFromHtml(article && article.summary);
        const built = rsvpBuild(blocks);
        ({ words, sentences, paragraphs } = built);
        if (!words.length) { error(srT('The summary is empty.')); return; }
        chunks = rsvpChunks(words, settings.chunk || 1);
        at = 0; started = Date.now();
        renderReader();
        if (reduceMotion) pause(srT('Paused. Press Space to start.'));
        else play();
    }

    let wordEl = null, sentenceEl = null, progressFill = null, progressText = null, playBtn = null, wpmText = null, contextEl = null;
    function renderReader() {
        state = 'reading';
        body.replaceChildren();
        sentenceEl = srEl('p', 'sr-sentence'); sentenceEl.setAttribute('aria-hidden', 'true');
        contextEl = srEl('div', 'sr-context'); contextEl.hidden = true;
        const stage = srEl('div', 'sr-stage');
        const guide = srEl('span', 'sr-guide'); guide.setAttribute('aria-hidden', 'true');
        wordEl = srEl('p', 'sr-word'); wordEl.setAttribute('aria-hidden', 'true');
        stage.append(guide, wordEl);
        body.append(sentenceEl, contextEl, stage);
        // footer: progress + controls
        foot.replaceChildren();
        const prog = srEl('div', 'sr-progress');
        const bar = srEl('div', 'sr-bar'); progressFill = srEl('span', 'sr-bar-fill'); bar.append(progressFill);
        progressText = srEl('span', 'sr-progress-text');
        prog.append(bar, progressText);
        const ctl = srEl('div', 'sr-controls');
        const back = srButton('sr-icon', '«', 'back', srT('Previous sentence'));
        playBtn = srButton('sr-play', '', 'play', srT('Pause'));
        const fwd = srButton('sr-icon', '»', 'fwd', srT('Next sentence'));
        const slower = srButton('sr-icon', '−', 'slower', srT('Slower'));
        wpmText = srEl('span', 'sr-wpm');
        const faster = srButton('sr-icon', '+', 'faster', srT('Faster'));
        const asText = srButton('sr-link', srT('Show as text'), 'text');
        const stop = srButton('sr-link', srT('Stop'), 'close');
        ctl.append(back, playBtn, fwd, srEl('span', 'sr-sp'), slower, wpmText, faster, srEl('span', 'sr-sp'), asText, stop);
        foot.append(prog, ctl);
        paint();
    }

    function paint() {
        if (!chunks.length || !wordEl) return;
        const c = chunks[Math.min(at, chunks.length - 1)];
        // word with the pivot letter (only for a single word; a chunk of 2–3 words is shown plain)
        wordEl.replaceChildren();
        if (c.from === c.to) {
            const w = c.text, p = rsvpPivot(w);
            const pre = srEl('span', 'sr-pre', w.slice(0, p)), piv = srEl('span', 'sr-pivot', w.charAt(p)), post = srEl('span', 'sr-post', w.slice(p + 1));
            wordEl.append(pre, piv, post);
            wordEl.classList.add('sr-word--pivot');
        } else { wordEl.textContent = c.text; wordEl.classList.remove('sr-word--pivot'); }
        // the sentence above, the current words marked
        const s = sentences[c.s];
        sentenceEl.replaceChildren();
        if (s) {
            const ws = s.text.split(' ').filter(Boolean);
            ws.forEach((w, k) => {
                const gi = s.first + k;
                const span = srEl('span', gi >= c.from && gi <= c.to ? 'sr-now' : null, w);
                sentenceEl.append(span, document.createTextNode(k < ws.length - 1 ? ' ' : ''));
            });
            sentenceEl.classList.toggle('sr-sentence--heading', !!s.heading);
        }
        const total = sentences.length;
        progressFill.style.setProperty('--sr-progress', String(Math.round(((at + 1) / chunks.length) * 1000) / 10) + '%');
        progressText.textContent = srT('Sentence {a} of {b} · {s} s left', { a: c.s + 1, b: total, s: rsvpSecondsLeft(chunks, at, wpm, sentences) });
        wpmText.textContent = srT('{n} WPM', { n: wpm });
        const playing = state === 'reading';
        playBtn.textContent = playing ? '❚❚' : '▶';
        playBtn.setAttribute('aria-label', playing ? srT('Pause') : srT('Continue'));
    }

    function tick() {
        timer = null;
        if (state !== 'reading') return;
        if (at >= chunks.length - 1) { done(); return; }
        at++;
        paint();
        schedule();
    }
    function schedule() {
        clearTimeout(timer);
        const c = chunks[at];
        timer = setTimeout(tick, rsvpDelayMs(c.text, wpm, { index: at, heading: !!(sentences[c.s] || {}).heading }));
    }
    function play() {
        if (!chunks.length) return;
        if (state === 'done' || at >= chunks.length - 1) at = 0;
        if (state !== 'reading') renderReaderIfNeeded();
        state = 'reading';
        contextEl.hidden = true; sentenceEl.hidden = false;
        box.classList.remove('sr--paused');
        schedule();
        paint();
    }
    function renderReaderIfNeeded() { if (!wordEl || !wordEl.isConnected) renderReader(); }
    function pause(message) {
        if (!chunks.length) return;
        clearTimeout(timer); timer = null;
        renderReaderIfNeeded();
        state = 'paused';
        box.classList.add('sr--paused');
        // the paragraph around the word: the sentence before, this one, the one after (click a sentence to read from there)
        const c = chunks[at];
        const para = paragraphs.find((p) => p.includes(c.s)) || [c.s];
        const pos = para.indexOf(c.s);
        const show = para.slice(Math.max(0, pos - 1), pos + 2);
        contextEl.replaceChildren();
        for (const si of show) {
            const b = srEl('button', 'sr-ctx' + (si === c.s ? ' sr-ctx--now' : ''), sentences[si].text);
            b.type = 'button'; b.dataset.act = 'jump'; b.dataset.s = String(si);
            contextEl.append(b);
        }
        contextEl.append(srEl('p', 'sr-hint', message || srT('Paused. Space continues · ←/→ jumps by sentence · click a sentence to read from there · T shows the whole summary')));
        contextEl.hidden = false; sentenceEl.hidden = true;
        paint();
        say(sentences[c.s] ? sentences[c.s].text : '');
    }
    function toggle() { if (state === 'reading') pause(); else if (state === 'paused' || state === 'done') play(); }
    function jumpSentence(delta) {
        if (!chunks.length) return;
        at = rsvpSentenceStart(chunks, at, delta);
        if (state === 'paused') pause(); else { paint(); if (state === 'reading') schedule(); }
    }
    function jumpWord(delta) {
        if (!chunks.length) return;
        at = Math.max(0, Math.min(chunks.length - 1, at + delta));
        if (state === 'paused') pause(); else { paint(); if (state === 'reading') schedule(); }
    }
    function setWpm(next) {
        wpm = rsvpClampWpm(next);
        if (opts.onSettings) opts.onSettings({ wpm });
        paint();
        if (state === 'reading') schedule();
    }

    // ── end ──
    function done() {
        clearTimeout(timer); timer = null;
        state = 'done';
        box.classList.remove('sr--paused');
        body.replaceChildren();
        const card = srEl('div', 'sr-done');
        card.append(srEl('h2', 'sr-done-title', srT('Finished reading')));
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        card.append(srEl('p', 'sr-done-meta', srT('{n} sentences · {s} s', { n: sentences.length, s: secs })));
        // reminder ("read later"): preselected from Settings, saved when it changes
        const rem = srEl('label', 'sr-reminder');
        rem.append(srEl('span', null, srT('Remind me')));
        const sel = document.createElement('select'); sel.dataset.act = 'reminder';
        const labels = { none: srT('No reminder'), tomorrow: srT('Tomorrow morning'), weekend: srT('At the weekend'), week: srT('Next week') };
        for (const tf of DECISION_TIMEFRAMES) { const o = document.createElement('option'); o.value = tf; o.textContent = labels[tf]; if (tf === reminder) o.selected = true; sel.append(o); }
        rem.append(sel);
        card.append(rem);
        if (reminder !== 'none' && opts.onReminder) opts.onReminder(reminder);
        const offerClose = settings.closeTab !== false && !!opts.onCloseTab;
        let ring = null;
        if (offerClose) {
            ring = srEl('div', 'sr-ring'); ring.setAttribute('aria-hidden', 'true');
            ring.append(srEl('span', 'sr-ring-num', String(SR_COUNTDOWN_S)));
            card.append(ring, srEl('p', 'sr-done-note', ''));
        }
        const row = srEl('div', 'sr-done-actions');
        row.append(srButton('sr-link', srT('Show as text'), 'text'), srButton(offerClose ? 'sr-btn' : 'sr-btn sr-btn--primary', srT('Keep page'), 'keep'));
        if (offerClose) row.append(srButton('sr-btn sr-btn--primary', srT('Close tab'), 'closetab'));
        card.append(row);
        if (offerClose) card.append(srEl('p', 'sr-hint', srT('Any key or mouse movement stops the countdown · Enter closes')));
        body.append(card);
        foot.replaceChildren();
        say(srT('Finished reading'));
        const primary = card.querySelector('.sr-btn--primary'); if (primary) primary.focus({ preventScroll: true });
        if (offerClose) startCountdown(card);
    }
    function startCountdown(card) {
        stopCountdown();
        if (document.hidden) { setNote(card, srT('Countdown stopped. The tab stays open.')); return; }   // never in the background
        countdownLeft = SR_COUNTDOWN_S;
        const num = card.querySelector('.sr-ring-num');
        setNote(card, srT('The tab closes in {n} s', { n: countdownLeft }));
        countdown = setInterval(() => {
            if (document.hidden) { stopCountdown(card); return; }
            countdownLeft--;
            if (num) num.textContent = String(Math.max(0, countdownLeft));
            card.style.setProperty('--sr-countdown', String(countdownLeft / SR_COUNTDOWN_S));
            if (countdownLeft <= 0) { stopCountdown(); closeTab(); return; }
            setNote(card, srT('The tab closes in {n} s', { n: countdownLeft }));
        }, 1000);
    }
    function setNote(card, t) { const n = card && card.querySelector('.sr-done-note'); if (n) n.textContent = t; }
    function stopCountdown(card) {
        if (countdown == null) return;
        clearInterval(countdown); countdown = null;
        const c = card || body.querySelector('.sr-done');
        if (c) { c.classList.add('sr-done--stopped'); setNote(c, srT('Countdown stopped. The tab stays open.')); }
    }
    function closeTab() { stopCountdown(); if (opts.onCloseTab) opts.onCloseTab(); destroy(); }

    // ── text view and errors ──
    function showText() {
        clearTimeout(timer); timer = null; stopCountdown();
        const was = state; state = 'text';
        body.replaceChildren();
        const art = srEl('article', 'sr-text');
        for (const b of blocks) art.append(srEl(b.heading ? 'h3' : 'p', null, b.text));
        body.append(art);
        foot.replaceChildren(srButton('sr-btn', srT('Back to the reader'), was === 'done' ? 'restart' : 'resume'), srEl('span', 'sr-sp'), srButton('sr-btn sr-btn--primary', srT('Keep page'), 'keep'));
        art.tabIndex = 0; art.focus({ preventScroll: true });
    }
    function error(message) {
        if (destroyed) return;
        clearTimeout(timer); timer = null; stopCountdown();
        state = 'error';
        body.replaceChildren();
        const wrap = srEl('div', 'sr-status sr-status--error');
        wrap.setAttribute('role', 'alert');
        wrap.append(srEl('p', 'sr-status-title', srT('The summary did not work')), srEl('p', 'sr-status-meta', String(message || '')), srEl('p', 'sr-hint', srT('The tab stays open.')));
        body.append(wrap);
        foot.replaceChildren(srButton('sr-btn', srT('Close'), 'close'), srEl('span', 'sr-sp'), ...(opts.onRetry ? [srButton('sr-btn sr-btn--primary', srT('Try again'), 'retry')] : []));
    }

    // ── input ──
    function onClick(e) {
        const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
        const act = b.dataset.act;
        if (act === 'close') { if (state === 'writing' && opts.onCancel) opts.onCancel(); destroy(); }
        else if (act === 'full') { const on = !box.classList.contains('sr--full'); box.classList.toggle('sr--full', on); fullBtn.setAttribute('aria-pressed', String(on)); if (opts.onSettings) opts.onSettings({ fullscreen: on }); }
        else if (act === 'play') toggle();
        else if (act === 'back') jumpSentence(-1);
        else if (act === 'fwd') jumpSentence(1);
        else if (act === 'slower') setWpm(wpm - RSVP_STEP_WPM);
        else if (act === 'faster') setWpm(wpm + RSVP_STEP_WPM);
        else if (act === 'text') showText();
        else if (act === 'resume') { renderReader(); pause(); }
        else if (act === 'restart') { renderReader(); done(); }
        else if (act === 'jump') { at = chunks.findIndex((c) => c.s === Number(b.dataset.s)); if (at < 0) at = 0; play(); }
        else if (act === 'keep') destroy();
        else if (act === 'closetab') closeTab();
        else if (act === 'retry') { const r = opts.onRetry; destroy(); if (r) r(); }
    }
    function onChange(e) {
        if (e.target.dataset.act !== 'reminder') return;
        reminder = e.target.value;
        stopCountdown();
        if (opts.onReminder) opts.onReminder(reminder);
    }
    function onKey(e) {
        if (e.isComposing) return;
        e.stopPropagation();   // the page's own shortcuts never see these keys
        if (state === 'done' && countdown != null && e.key !== 'Enter') stopCountdown();
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); if (state === 'writing' && opts.onCancel) opts.onCancel(); destroy(); return; }
        if (k === 'Tab') { trapFocus(e); return; }
        if (e.target && e.target.tagName === 'SELECT') return;
        if (state === 'done' && k === 'Enter' && e.target === box) { e.preventDefault(); const p = body.querySelector('.sr-btn--primary'); if (p) p.click(); return; }
        if (state === 'text' || state === 'error' || state === 'writing') return;
        if (k === ' ' || k === 'k' || k === 'K') { if (e.target.tagName === 'BUTTON' && k === ' ') return; e.preventDefault(); toggle(); }
        else if (k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) jumpWord(-1); else jumpSentence(-1); }
        else if (k === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) jumpWord(1); else jumpSentence(1); }
        else if (k === 'ArrowUp') { e.preventDefault(); setWpm(wpm + RSVP_STEP_WPM); }
        else if (k === 'ArrowDown') { e.preventDefault(); setWpm(wpm - RSVP_STEP_WPM); }
        else if (k === 't' || k === 'T') { e.preventDefault(); showText(); }
        else if (k === 'f' || k === 'F') { e.preventDefault(); fullBtn.click(); }
    }
    function trapFocus(e) {
        const items = [...root.querySelectorAll('button, select, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!items.length) return;
        const cur = root.activeElement, i = items.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && (i === items.length - 1 || i < 0)) { e.preventDefault(); items[0].focus(); }
    }
    const onMove = () => { if (state === 'done' && countdown != null) stopCountdown(); };
    const onVisibility = () => { if (document.hidden) { if (state === 'reading') pause(); if (countdown != null) stopCountdown(); } };
    box.addEventListener('click', onClick);
    box.addEventListener('change', onChange);
    box.addEventListener('keydown', onKey);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('wheel', onMove, { passive: true });
    scrim.addEventListener('click', () => { if (state === 'reading') pause(); });
    document.addEventListener('visibilitychange', onVisibility);

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(timer); timer = null;
        if (countdown != null) { clearInterval(countdown); countdown = null; }
        document.removeEventListener('visibilitychange', onVisibility);
        host.remove();
        if (srActive === api) srActive = null;
        try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch (_) { /* element gone */ }
    }

    renderWriting();
    const api = { stream, read, error, destroy, get state() { return state; }, get at() { return at; }, get wpm() { return wpm; }, root, pause, play };
    return api;
}

// for the tests
export const __srLimits = { RSVP_MIN_WPM, RSVP_MAX_WPM, SR_COUNTDOWN_S };
