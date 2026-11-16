// articleLinks.js — "Links in this article" (Figma AISH-041 B): the links in a saved article's text, sources first, each with the
// sentence it sits in. Each one can be summarized (a background tab, the same queue as Feeds: action openFeedItem) and is then an
// article in the library: its summary shows here, "Open" goes to it (and to its own links, one level at a time). Summarized ones can
// be ticked and, together with this article, go into a collection or a quiz (AISH-040).
// Link picking is pure (`extractLinks`, test262); nothing leaves the device until the reader taps Summarize.
import { T, TN } from './feedI18n.js';
import { el } from './dom.js';

export const LINKS_MAX = 40;          // links listed per article
export const BATCH_MAX = 5;           // "Summarize the n sources" at most

// cue words in the sentence around a link that mark it as a source the article relies on (several languages, lower case)
const CUES = /\b(according to|study|studies|report|survey|research|researchers|data|paper|analysis|published|found|finds|shows?|showed|estimates?|figures|statistics|trial|review|journal|source|laut|studie|bericht|umfrage|daten|forscher|zeigt|zeigte|analyse|untersuchung|quelle|selon|étude|rapport|enquête|données|chercheurs|según|estudio|informe|encuesta|datos|secondo|studio|rapporto|indagine|dati|volgens|onderzoek|rapport|gegevens|segundo|estudo|relatório|dados|według|badanie|raport|согласно|исследование|отчёт|данные)\b/i;
const RESEARCH_HOSTS = /(^|\.)(doi\.org|arxiv\.org|nature\.com|science\.org|sciencedirect\.com|springer\.com|link\.springer\.com|wiley\.com|tandfonline\.com|ncbi\.nlm\.nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|nih\.gov|jstor\.org|ssrn\.com|researchgate\.net|plos\.org|biorxiv\.org|medrxiv\.org|thelancet\.com|bmj\.com|nejm\.org|who\.int|oecd\.org|europa\.eu|un\.org|worldbank\.org|imf\.org|destatis\.de|ourworldindata\.org)$/i;
const SKIP_HOSTS = /(^|\.)(facebook\.com|twitter\.com|x\.com|t\.co|linkedin\.com|instagram\.com|pinterest\.com|reddit\.com|whatsapp\.com|wa\.me|telegram\.me|t\.me|tiktok\.com|youtube\.com\/subscription|doubleclick\.net|googleadservices\.com|amazon-adsystem\.com|addthis\.com|sharethis\.com|disqus\.com|flipboard\.com)$/i;
const SKIP_PATHS = /\/(login|log-in|signin|sign-in|signup|sign-up|register|subscribe|subscription|newsletter|account|privacy|datenschutz|impressum|imprint|terms|agb|cookies?|cookie-policy|contact|kontakt|about-us|advertis\w*|jobs|careers|shop|cart|search|tag|tags|category|categories|author|authors|topics?|thema|themen)(\/|$)/i;
const SKIP_FILES = /\.(jpe?g|png|gif|webp|svg|mp3|mp4|mov|zip|exe|dmg)(\?|#|$)/i;

/** Same page key as the worker's summary queue (sumJobKey): host without www + path + content query, lower case. */
export function linkKey(u) {
    try {
        const x = new URL(u);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'].forEach(k => x.searchParams.delete(k));
        const qs = x.searchParams.toString();
        return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '')).toLowerCase();
    } catch (_) { return String(u || '').toLowerCase().trim(); }
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The sentence of `block` that holds `anchorText` (or the start of the block), at most ~220 characters. */
function contextSentence(blockText, anchorText) {
    const text = clean(blockText);
    if (!text) return '';
    const at = anchorText ? text.indexOf(clean(anchorText)) : -1;
    const sentences = text.replace(/([.!?]+["“”’)\]]*)\s+/g, '$1\u0001').split('\u0001');
    let pos = 0, hit = sentences[0] || '';
    for (const s of sentences) { if (at >= pos && at < pos + s.length + 1) { hit = s; break; } pos += s.length + 1; }
    hit = hit.trim();
    if (hit.length <= 220) return hit;
    const i = Math.max(0, hit.indexOf(clean(anchorText)) - 90);
    return (i > 0 ? '…' : '') + hit.slice(i, i + 210).trim() + '…';
}

/**
 * Links in an article's saved HTML, resolved against its URL, without navigation/social/ads/legal pages, the article itself and
 * duplicates. kind: 'source' (cited in a sentence with a cue word, or a paper / PDF / research host), 'mention' (in the running
 * text), 'other' (lists, link-only lines). Sorted sources → mentions → other, each in text order. Pure (needs DOMParser).
 * Returns [{ url, key, title, host, context, kind, paper, pdf }].
 */
export function extractLinks(html, baseUrl, { max = LINKS_MAX } = {}) {
    if (!html || typeof DOMParser !== 'function') return [];
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const selfKey = linkKey(baseUrl || '');
    const seen = new Map();
    const out = [];
    for (const a of doc.querySelectorAll('a[href]')) {
        const raw = (a.getAttribute('href') || '').trim();
        if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
        let url;
        try { url = new URL(raw, baseUrl || undefined); } catch (_) { continue; }
        if (!/^https?:$/.test(url.protocol)) continue;
        url.hash = '';
        const key = linkKey(url.href);
        if (!key || key === selfKey) continue;
        const host = url.hostname.replace(/^www\./, '');
        if (SKIP_HOSTS.test(host) || SKIP_FILES.test(url.pathname)) continue;
        if (SKIP_PATHS.test(url.pathname) && !RESEARCH_HOSTS.test(host)) continue;
        if (url.pathname === '/' && !url.search) continue;   // a site's home page is navigation, not a source
        const text = clean(a.textContent);
        const block = a.closest('p, li, blockquote, dd, td, figcaption, h1, h2, h3, h4, h5, h6') || a.parentElement;
        const blockText = clean(block ? block.textContent : '');
        const inProse = !!block && /^(P|BLOCKQUOTE|DD|TD|FIGCAPTION)$/.test(block.tagName) && blockText.length > text.length + 25;
        const inListProse = !!block && block.tagName === 'LI' && blockText.length > text.length + 40;
        const context = inProse || inListProse ? contextSentence(blockText, text) : '';
        const pdf = /\.pdf(\?|$)/i.test(url.pathname);
        const paper = pdf || RESEARCH_HOSTS.test(host) || /\/doi\/|10\.\d{4,9}\//i.test(url.href);
        const kind = paper || (context && CUES.test(context)) ? 'source' : (inProse || inListProse) ? 'mention' : 'other';
        if (seen.has(key)) {   // the same link twice: keep the strongest reading
            const prev = seen.get(key);
            if (kind === 'source' && prev.kind !== 'source') Object.assign(prev, { kind, context: context || prev.context });
            continue;
        }
        const item = { url: url.href, key, title: text && text.length > 2 && !/^https?:\/\//i.test(text) ? text.slice(0, 140) : host + (url.pathname.length > 1 ? url.pathname.slice(0, 60) : ''), host, context, kind, paper, pdf, order: out.length };
        seen.set(key, item); out.push(item);
    }
    const rank = { source: 0, mention: 1, other: 2 };
    return out.sort((x, y) => rank[x.kind] - rank[y.kind] || x.order - y.order).slice(0, max).map(({ order, ...rest }) => rest);
}

/** Map key → saved article (by url and by the feed/redirect url it was opened from). */
export function savedByKey(index) {
    const m = new Map();
    for (const a of index || []) {
        if (!a || a.feedStub) continue;
        if (a.url) m.set(linkKey(a.url), a);
        if (a.feedUrl) m.set(linkKey(a.feedUrl), a);
    }
    return m;
}

const plain = (html) => clean(String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

/**
 * Draws the section into `host`. deps: { article, html, openArticle(a), toast(msg), getIndex(), send(msg) → Promise, onCount?(n) }.
 * Returns { destroy }.
 */
export function mountArticleLinks(host, deps) {
    const { article } = deps;
    const links = extractLinks(deps.html, article.url);
    host.textContent = '';
    if (deps.onCount) deps.onCount(links.length);
    if (!links.length) { host.hidden = true; return { destroy() {} }; }
    host.hidden = false;
    const state = { saved: new Map(), running: '', queued: new Set(), asked: new Map(), failed: new Set(), picked: new Set() };
    const counts = { source: 0, mention: 0, other: 0 };
    links.forEach(l => counts[l.kind]++);

    const head = el('div', 'links-head');
    const h = el('h3', 'links-title', '🔗 ' + T('Links in this article'));
    h.append(' ', el('span', 'links-n', String(links.length)));
    head.append(h);
    const batchBtn = el('button', 'button-primary btn-sm links-batch'); batchBtn.type = 'button';
    const intro = el('p', 'links-intro', T('Summarize what the article links to, to see what its sources really say. Each page opens in a background tab.'));
    const list = el('div', 'links-groups');
    const bar = el('div', 'links-selbar'); bar.hidden = true;
    host.append(head, intro, batchBtn, list, bar);

    // asked = key → when it was last seen waiting/running (or asked for): until an article arrives or it has been gone for a while, it is still on its way
    const statusOf = (l) => state.saved.has(l.key) ? 'done' : state.running === l.key ? 'running' : (state.queued.has(l.key) || state.asked.has(l.key)) ? 'queued' : state.failed.has(l.key) ? 'failed' : 'idle';

    const summarize = (items) => {
        items.forEach((l) => {
            if (statusOf(l) === 'done' || statusOf(l) === 'running' || statusOf(l) === 'queued') return;
            state.failed.delete(l.key); state.queued.add(l.key); state.asked.set(l.key, Date.now());
            deps.send({ action: 'openFeedItem', url: l.url, title: l.title, summarize: true, forceExtension: true })
                .then((r) => { if (!r || !r.success) { state.queued.delete(l.key); state.failed.add(l.key); paint(); } })
                .catch(() => { state.queued.delete(l.key); state.failed.add(l.key); paint(); });
        });
        paint();
    };

    function row(l) {
        const st = statusOf(l);
        const r = el('div', 'links-row is-' + st); r.setAttribute('role', 'listitem');
        const top = el('div', 'links-row-top');
        if (st === 'done') {
            const cb = el('input', 'links-pick'); cb.type = 'checkbox'; cb.checked = state.picked.has(l.key);
            cb.setAttribute('aria-label', T('Select “{title}”', { title: l.title }));
            cb.addEventListener('change', () => { if (cb.checked) state.picked.add(l.key); else state.picked.delete(l.key); paintBar(); });
            top.append(cb);
        }
        const tx = el('div', 'links-tx');
        const t = el('a', 'links-t', l.title); t.href = l.url; t.target = '_blank'; t.rel = 'noopener noreferrer';
        tx.append(t, el('div', 'links-meta', l.host + (l.pdf ? ' · PDF' : l.paper ? ' · ' + T('paper') : '')));
        if (l.context && st !== 'done') tx.append(el('div', 'links-ctx', '“' + l.context + '”'));
        top.append(tx);
        if (st === 'idle' || st === 'failed') {
            const b = el('button', 'button-secondary btn-sm links-go', st === 'failed' ? T('Try again') : T('Summarize')); b.type = 'button';
            b.addEventListener('click', () => summarize([l]));
            top.append(b);
        } else if (st === 'running' || st === 'queued') {
            top.append(el('span', 'links-state', st === 'running' ? T('Summarizing…') : T('Waiting')));
        }
        r.append(top);
        if (st === 'failed') r.append(el('div', 'links-fail', T('Could not read this page (a paywall, a cookie banner or no text). Open it to check it yourself.')));
        if (st === 'done') {
            const a = state.saved.get(l.key);
            const sum = plain(a.summary);
            r.append(el('div', 'links-sum', sum.length > 320 ? sum.slice(0, 319).trimEnd() + '…' : sum));
            const open = el('button', 'links-open', T('Open') + ' ›'); open.type = 'button';
            open.addEventListener('click', () => deps.openArticle(a));
            r.append(open);
        }
        return r;
    }

    function group(kind, label, collapsed) {
        const items = links.filter(l => l.kind === kind);
        if (!items.length) return null;
        const wrap = collapsed ? el('details', 'links-group links-group--' + kind) : el('div', 'links-group links-group--' + kind);
        const cap = el(collapsed ? 'summary' : 'div', 'links-cap', label + ' · ' + items.length);
        const rows = el('div', 'links-rows'); rows.setAttribute('role', 'list'); rows.setAttribute('aria-label', label);
        items.forEach(l => rows.append(row(l)));
        wrap.append(cap, rows);
        return wrap;
    }

    function paintBar() {
        const n = state.picked.size;
        bar.hidden = n === 0;
        bar.textContent = '';
        if (!n) return;
        const picked = links.filter(l => state.picked.has(l.key)).map(l => state.saved.get(l.key)).filter(Boolean);
        const set = [article, ...picked];
        bar.append(el('span', 'links-sel-n', TN(n, '{n} selected, with this article', '{n} selected, with this article')));
        const coll = el('button', 'button-secondary btn-sm', '📚 ' + T('Collection')); coll.type = 'button';
        coll.addEventListener('click', async () => { try { const { openAddSheet } = await import('./collectionsView.js'); await openAddSheet(set, {}); } catch (_) { deps.toast(T('Could not open collections')); } });
        const quiz = el('button', 'button-secondary btn-sm', '🎓 ' + T('Quiz')); quiz.type = 'button';
        quiz.addEventListener('click', async () => { const { openQuiz } = await import('./quiz/quizView.js'); openQuiz(set, { name: T('Sources: {title}', { title: article.title || article.url || '' }), toast: deps.toast }); });
        bar.append(coll, quiz);
    }

    function paint() {
        // keep open/closed state of the collapsible group across repaints
        const otherOpen = !!list.querySelector('details.links-group--other[open]');
        list.textContent = '';
        const groups = [group('source', T('Sources the article cites'), false), group('mention', T('Mentioned in the text'), false), group('other', T('Other links'), true)].filter(Boolean);
        groups.forEach(g => list.append(g));
        const other = list.querySelector('details.links-group--other'); if (other && otherOpen) other.open = true;
        const todo = links.filter(l => l.kind === 'source' && statusOf(l) === 'idle').slice(0, BATCH_MAX);
        batchBtn.hidden = todo.length === 0;
        batchBtn.textContent = '✨ ' + TN(todo.length, 'Summarize the source', 'Summarize the {n} sources');
        batchBtn.onclick = () => summarize(todo);
        // what is gone from the queue without an article after a while could not be read
        const now = Date.now();
        for (const [key, at] of state.asked) {
            if (state.saved.has(key)) { state.asked.delete(key); continue; }
            if (state.running !== key && !state.queued.has(key) && now - at > 8000) { state.failed.add(key); state.asked.delete(key); }
        }
        paintBar();
    }

    let alive = true;
    const refreshSaved = async () => {
        const idx = await deps.getIndex().catch(() => []);
        if (!alive) return;
        const by = savedByKey(idx);
        state.saved = new Map(links.filter(l => by.has(l.key)).map(l => [l.key, by.get(l.key)]));
        paint();
    };
    const onQueue = (msg) => {
        if (!msg || msg.action !== 'summaryQueue') return;
        state.running = msg.running && msg.running.url ? linkKey(msg.running.url) : '';
        state.queued = new Set((msg.queue || []).map(j => linkKey(j.url)));
        const now = Date.now();
        for (const key of state.asked.keys()) if (key === state.running || state.queued.has(key)) state.asked.set(key, now);   // still alive
        paint();
        if (!msg.running && !(msg.queue || []).length) setTimeout(refreshSaved, 1500);   // the last one just finished
    };
    const onStorage = (changes, area) => { if (area === 'local' && changes['articles:index']) refreshSaved(); };
    try { chrome.runtime.onMessage.addListener(onQueue); chrome.storage.onChanged.addListener(onStorage); } catch (_) { /* tests */ }
    deps.send({ action: 'summaryJobs' }).then((r) => onQueue({ ...(r || {}), action: 'summaryQueue' })).catch(() => {});
    const tick = setInterval(() => { if (state.asked.size) paint(); }, 4000);
    paint();
    refreshSaved();
    return {
        destroy() {
            alive = false; clearInterval(tick);
            try { chrome.runtime.onMessage.removeListener(onQueue); chrome.storage.onChanged.removeListener(onStorage); } catch (_) { /* tests */ }
        },
        __state: state, __links: links, __queue: onQueue, __refresh: refreshSaved,
    };
}
