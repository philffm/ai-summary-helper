// storageHealth.js — when the extension gets heavy: which saved articles are big AND have not been opened for a long time.
// Pure helpers (tested without a browser) plus the sheet that lists them. Nothing is deleted without the reader ticking it,
// and articles that are starred or sit in a collection are never offered.
import { T } from './feedI18n.js';
import { stripImages, imageBytes } from '../content/stripImages.js';
import { ARTICLE_REC } from './storageKeys.js';

export const OLD_DAYS = 90;                    // "not opened for months"
export const HEAVY_INDEX_BYTES = 5 * 1024 * 1024;     // ⚠️ assumption: the index (all summaries) is read on every open; beyond ~5 MB it is felt
export const HEAVY_TOTAL_BYTES = 150 * 1024 * 1024;   // ⚠️ assumption: total local storage
export const MIN_CANDIDATE_BYTES = 50 * 1024;         // below this an article is not worth listing

/** Rough size of one saved article: page text (words × ~6.5 characters) plus the summary. Pure. */
export function estimateBytes(a) {
    const words = Number(a && a.contentWordCount) || 0;
    return Math.round(words * 6.5 + String((a && a.summary) || '').length + 300);
}

/** Days since the article was last opened (or saved when never opened). Infinity when no date. Pure. */
export function daysUnopened(a, now = Date.now()) {
    const t = new Date((a && (a.lastOpened || a.timestamp)) || NaN).getTime();
    return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : Infinity;
}

/**
 * Large articles not opened for `minDays`, biggest first. Starred articles, articles in a collection (`keep` = Set of ids),
 * unfinished feed stubs and anything below MIN_CANDIDATE_BYTES are left out. Returns { list, bytes, kept } (kept = protected ones skipped). Pure.
 */
export function reclaimCandidates(index, { now = Date.now(), minDays = OLD_DAYS, keep = new Set(), limit = 200, minBytes = MIN_CANDIDATE_BYTES } = {}) {
    const list = []; let kept = 0;
    for (const a of index || []) {
        if (!a || !a.id || a.feedStub || a.contentPruned) continue;
        const bytes = estimateBytes(a);
        if (bytes < minBytes || daysUnopened(a, now) < minDays) continue;
        if (a.favorite || keep.has(a.id)) { kept++; continue; }
        list.push({ id: a.id, title: a.title || a.url || '', bytes, days: Math.floor(daysUnopened(a, now)) });
    }
    list.sort((x, y) => y.bytes - x.bytes);
    const top = list.slice(0, limit);
    return { list: top, bytes: list.reduce((s, x) => s + x.bytes, 0), kept, total: list.length };
}

/** 'ok' | 'heavy' from measured sizes. Pure. */
export function healthLevel({ totalBytes = 0, indexBytes = 0 } = {}) {
    return indexBytes > HEAVY_INDEX_BYTES || totalBytes > HEAVY_TOTAL_BYTES ? 'heavy' : 'ok';
}

export function formatBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024 * 1024) return (v / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(v >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
    return Math.max(1, Math.round(v / 1024)) + ' KB';
}


// ── duplicates ──────────────────────────────────────────────────────────────

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$)/i;
/** The same page, whatever the tracking parameters, #fragment, trailing slash or www. Pure. */
export function normUrl(u) {
    try {
        const x = new URL(String(u));
        const keep = [...x.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('&');
        return (x.hostname.replace(/^www\./, '') + (x.pathname.replace(/\/+$/, '') || '/') + (keep ? '?' + keep : '')).toLowerCase();
    } catch (_) { return String(u || '').trim().toLowerCase(); }
}
const hostOf = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Articles saved more than once: same page (normalised URL), or same title on the same site. In every group one copy stays
 * (starred / in a collection first, then the one with a summary, then the newest); the other copies are offered. Copies that
 * are starred or in a collection are never offered. Returns { list, total, kept, groups }. Pure.
 */
export function findDuplicates(index, { keep = new Set(), now = Date.now(), limit = 300 } = {}) {
    const real = (index || []).filter(a => a && a.id && !a.feedStub);
    const byUrl = new Map();
    for (const a of real) { const k = a.url ? 'u:' + normUrl(a.url) : ''; if (k) (byUrl.get(k) || byUrl.set(k, []).get(k)).push(a); }
    const used = new Set(); const groups = [];
    for (const g of byUrl.values()) if (g.length > 1) { groups.push(g); g.forEach(a => used.add(a.id)); }
    const byTitle = new Map();
    for (const a of real) {
        if (used.has(a.id)) continue;
        const t = normTitle(a.title);
        if (t.length < 15 || !hostOf(a.url)) continue;
        const k = 't:' + hostOf(a.url) + '|' + t;
        (byTitle.get(k) || byTitle.set(k, []).get(k)).push(a);
    }
    for (const g of byTitle.values()) if (g.length > 1) groups.push(g);
    const score = (a) => (a.favorite ? 8 : 0) + (keep.has(a.id) ? 4 : 0) + (String(a.summary || '').trim() ? 2 : 0);
    const list = []; let kept = 0;
    for (const g of groups) {
        const sorted = [...g].sort((x, y) => score(y) - score(x) || new Date(y.timestamp || 0) - new Date(x.timestamp || 0) || String(y.summary || '').length - String(x.summary || '').length);
        const stay = sorted[0];
        for (const a of sorted.slice(1)) {
            if (a.favorite || keep.has(a.id)) { kept++; continue; }
            list.push({ id: a.id, title: a.title || a.url || '', bytes: estimateBytes(a), days: Math.floor(daysUnopened(a, now)), dupOf: stay.title || stay.url || '' });
        }
    }
    list.sort((x, y) => y.bytes - x.bytes);
    return { list: list.slice(0, limit), total: list.length, kept, groups: groups.length };
}

// ── measuring (browser) ─────────────────────────────────────────────────────

const inUse = (keys) => new Promise(r => { try { chrome.storage.local.getBytesInUse(keys, (b) => r(b || 0)); } catch (_) { r(0); } });

/** { totalBytes, indexBytes, candidates } for the hint and the sheet. `index` = the full article index (archived too). */
export async function measure(index, indexKey, keepIds = new Set(), opts = {}) {
    const [totalBytes, indexBytes] = await Promise.all([inUse(null), inUse([indexKey])]);
    return { totalBytes, indexBytes, level: healthLevel({ totalBytes, indexBytes }), candidates: reclaimCandidates(index, { keep: keepIds, ...opts }), dupes: findDuplicates(index, { keep: keepIds }) };
}

// ── sheet ───────────────────────────────────────────────────────────────────

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/**
 * Bottom sheet: the big, long-unopened articles with their rough size; tick what can go, then delete. Summaries of other articles stay.
 * `deleteIds(ids)` does the deletion (and cache refresh) for the caller; `onDone(n)` runs after.
 */
export async function openStorageSheet({ report, index = null, keep = new Set(), deleteIds, pruneIds, onDone = () => {} }) {
    const { trapFocus } = await import('./sheet.js');
    document.querySelectorAll('.storage-sheet').forEach(n => n.remove());
    const sheet = el('div', 'sendsheet storage-sheet');
    const scrim = el('div', 'sendsheet-scrim');
    const panel = el('div', 'sendsheet-panel');
    const body = el('div', 'sendsheet-body');
    panel.append(el('div', 'sendsheet-grab'), body); sheet.append(scrim, panel); document.body.append(sheet);
    let trap = null;
    const close = () => { if (trap) trap.release(); sheet.remove(); };
    scrim.addEventListener('click', close);
    trap = trapFocus(panel, { label: T('Free up space'), onEscape: close });
    const dupes = report.dupes || { list: [], total: 0, kept: 0 };
    const dupIds = new Set(dupes.list.map(x => x.id));
    let cand = report.candidates;
    let list = cand.list.filter(x => !dupIds.has(x.id));   // a duplicate is listed once, under Duplicates
    const seen = new Map([...dupes.list, ...list].map(x => [x.id, x]));   // everything ever shown, so the size of ticked rows stays known after a filter change
    const everything = () => [...dupes.list, ...list];
    const head = el('div', 'sendsheet-head');
    head.append(el('div', 'sendsheet-title', T('Free up space')),
        el('div', 'sendsheet-sub', T('Saved data: {size}. Tick what can go.', { size: formatBytes(report.totalBytes) })));
    body.append(head);
    const picked = new Set();
    const listEl = el('div', 'coll-pick coll-pick--scroll');
    const action = el('button', pruneIds ? 'button-danger-outline' : 'button-primary'); action.type = 'button';
    const prune = pruneIds ? el('button', 'button-primary') : null; if (prune) prune.type = 'button';
    const sync = () => {
        const bytes = [...picked].reduce((s, id) => s + ((seen.get(id) || {}).bytes || 0), 0);
        action.textContent = picked.size ? T('Delete {n} (about {size})', { n: picked.size, size: formatBytes(bytes) }) : T('Select what can go');
        action.disabled = !picked.size;
        if (prune) { prune.textContent = picked.size ? T('Remove page text of {n} (about {size})', { n: picked.size, size: formatBytes(bytes) }) : T('Select what can go'); prune.disabled = !picked.size; }
    };
    const PAGE = 50;
    const rowFor = (x, sub) => {
        const r = el('button', 'sendsheet-row'); r.type = 'button'; r.setAttribute('role', 'checkbox'); r.setAttribute('aria-checked', String(picked.has(x.id)));
        r.classList.toggle('on', picked.has(x.id));
        const tx = el('span', 'sendsheet-row-tx');
        tx.append(el('span', 'sendsheet-row-t', x.title || T('Untitled')), el('span', 'sendsheet-row-s', sub));
        const box = el('span', 'coll-radio coll-radio--box'); box.setAttribute('aria-hidden', 'true');
        r.append(tx, box);
        r.addEventListener('click', () => {
            if (picked.has(x.id)) picked.delete(x.id); else picked.add(x.id);
            r.classList.toggle('on', picked.has(x.id)); r.setAttribute('aria-checked', String(picked.has(x.id))); sync();
        });
        return r;
    };
    /** A titled group of rows: shows PAGE rows, "Show more" adds PAGE more, "Select all" ticks the whole group (also the hidden rows). */
    const group = (title, hint, items, subOf) => {
        if (!items.length) return;
        const h = el('div', 'storage-group-head');
        h.append(el('strong', null, title + ' · ' + items.length));
        const all = el('button', 'button-secondary btn-sm', T('Select all')); all.type = 'button';
        h.append(all);
        listEl.append(h);
        if (hint) listEl.append(el('p', 'coll-note', hint));
        const rows = el('div', 'storage-group-rows'); listEl.append(rows);
        let shown = 0;
        const more = el('button', 'button-secondary btn-sm', ''); more.type = 'button';
        const paint = () => {
            items.slice(shown, shown + PAGE).forEach(x => rows.append(rowFor(x, subOf(x)))); shown = Math.min(items.length, shown + PAGE);
            more.hidden = shown >= items.length; more.textContent = T('Show more ({n})', { n: items.length - shown });
        };
        more.addEventListener('click', paint);
        all.addEventListener('click', () => {
            const every = items.every(x => picked.has(x.id));
            items.forEach(x => { if (every) picked.delete(x.id); else picked.add(x.id); });
            rows.querySelectorAll('.sendsheet-row').forEach((r, i) => { const on = picked.has(items[i].id); r.classList.toggle('on', on); r.setAttribute('aria-checked', String(on)); });
            sync();
        });
        paint(); listEl.append(more);
    };
    const renderList = () => {
        listEl.textContent = '';
        group(T('Duplicates'), T('The same page saved more than once. The newest copy with a summary stays.'), dupes.list,
            (x) => T('Copy of “{t}”', { t: String(x.dupOf).slice(0, 60) }) + ' · ~' + formatBytes(x.bytes));
        group(T('Large and not opened'), '', list, (x) => '~' + formatBytes(x.bytes) + ' · ' + T('not opened for {d} days', { d: x.days }));
        if (!dupes.list.length && !list.length) listEl.append(el('p', 'coll-note', T('Nothing large, unopened or duplicated to remove.')));
        if (cand.total > cand.list.length) listEl.append(el('p', 'coll-note', T('Showing the {n} largest of {m}.', { n: cand.list.length, m: cand.total })));
        sync();
    };
    if (index) {   // age filter: All shows every article (also recent and small ones), biggest first
        const ages = [[0, T('All')], [30, '30+'], [90, '90+'], [180, '180+']];
        const wrap = el('div', 'storage-age'); wrap.append(el('span', 'coll-note', T('Not opened for at least (days)')));
        const segEl = el('div', 'a11y-seg'); segEl.setAttribute('role', 'radiogroup'); wrap.append(segEl);
        let cur = report.minDays ?? OLD_DAYS;
        const paintSeg = () => [...segEl.children].forEach(b => { const on = Number(b.dataset.value) === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        ages.forEach(([v, label]) => { const b = el('button', null, label); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.value = String(v);
            b.addEventListener('click', () => {
                cur = v; paintSeg();
                cand = reclaimCandidates(index, { keep, minDays: v, minBytes: v === 0 ? 1 : 10 * 1024, limit: 5000 });
                list = cand.list.filter(x => !dupIds.has(x.id)); list.forEach(x => seen.set(x.id, x));
                renderList();
            }); segEl.append(b); });
        paintSeg(); body.append(wrap);
    }
    body.append(listEl);
    renderList();
    if (cand.kept || dupes.kept) body.append(el('p', 'coll-note', T('{n} more are starred or in a collection and are never listed.', { n: cand.kept + dupes.kept })));
    body.append(el('p', 'coll-note', pruneIds ? T('Removing the page text keeps title, summary, tags and highlights, and the statistics stay the same. Deleting removes the whole article. Export a backup first if unsure.') : T('Deleting removes the summary and the saved page text. Export a backup first if unsure.')));
    const actions = el('div', 'coll-actions');
    const cancel = el('button', 'button-secondary', T('Cancel')); cancel.type = 'button'; cancel.addEventListener('click', close);
    action.addEventListener('click', async () => {
        if (!picked.size) return;
        if (!window.confirm(T('Delete {n} articles? This cannot be undone.', { n: picked.size }))) return;
        action.disabled = true;
        const ids = [...picked];
        await deleteIds(ids);
        close(); onDone(ids.length);
    });
    if (prune) prune.addEventListener('click', async () => {
        if (!picked.size) return;
        prune.disabled = true;
        const ids = [...picked];
        await pruneIds(ids);
        close(); onDone(ids.length, 'pruned');
    });
    actions.append(cancel, action); if (prune) actions.append(prune); body.append(actions); sync();
}

// ── cleanup that keeps the summaries (and so the statistics) ────────────────

const getAll = () => new Promise(r => { try { chrome.storage.local.get(null, (d) => r(d || {})); } catch (_) { r({}); } });
const setMany = (o) => new Promise(r => { try { chrome.storage.local.set(o, () => r()); } catch (_) { r(); } });

/**
 * What a cleanup would free, from the real records: { images: {n, bytes}, text: {n, bytes} }.
 * Images = inlined pictures; text = the saved page text (images included) of articles older than `minDays` that are not
 * starred or in a collection. Summaries stay either way. Counts only, nothing changes.
 */
export async function scanCleanup(index, { minDays = OLD_DAYS, keep = new Set() } = {}) {
    const all = await getAll();
    const out = { images: { n: 0, bytes: 0 }, text: { n: 0, bytes: 0 }, contentBytes: 0 };
    const textIds = new Set(textCleanupIds(index, { minDays, keep }));
    for (const a of index || []) {
        const rec = all[ARTICLE_REC + a.id];
        if (!rec || typeof rec.content !== 'string' || !rec.content) continue;
        const ib = imageBytes(rec.content);
        out.contentBytes += rec.content.length;
        if (ib > 0) { out.images.n++; out.images.bytes += ib; }
        if (textIds.has(a.id)) { out.text.n++; out.text.bytes += rec.content.length; }
    }
    return out;
}

/** Removes the pictures from every saved page. Text, summary, highlights and statistics are untouched. Returns { n, bytes }. */
export async function removeSavedImages(index) {
    const all = await getAll();
    const batch = {}; let n = 0, bytes = 0;
    for (const a of index || []) {
        const key = ARTICLE_REC + a.id; const rec = all[key];
        if (!rec || typeof rec.content !== 'string') continue;
        const ib = imageBytes(rec.content);
        const next = stripImages(rec.content);
        if (next === rec.content) continue;
        bytes += Math.max(0, rec.content.length - next.length); n++;
        batch[key] = { ...rec, content: next };
        if (Object.keys(batch).length >= 25) { await setMany(batch); for (const k of Object.keys(batch)) delete batch[k]; }
    }
    if (Object.keys(batch).length) await setMany(batch);
    return { n, bytes };
}

/**
 * Deletes the saved page text (and with it the pictures) of the given articles but keeps title, summary, tags, highlights,
 * conversation and the word counts, so the statistics do not move. Flags them `contentPruned`. Returns { n, bytes }.
 */
export async function dropPageText(index, ids, indexKey) {
    const set = new Set(ids || []);
    const all = await getAll();
    const batch = {}; let n = 0, bytes = 0;
    for (const id of set) {
        const key = ARTICLE_REC + id; const rec = all[key];
        if (!rec || typeof rec.content !== 'string' || !rec.content) continue;
        bytes += rec.content.length; n++;
        batch[key] = { ...rec, content: '', contentPruned: true };
        if (Object.keys(batch).length >= 25) { await setMany(batch); for (const k of Object.keys(batch)) delete batch[k]; }
    }
    const raw = Array.isArray(all[indexKey]) ? all[indexKey] : (index || []);   // the stored index itself, so nothing else in it changes
    const next = raw.map(a => set.has(a.id) ? { ...a, contentPruned: true } : a);
    batch[indexKey] = next;
    await setMany(batch);
    return { n, bytes };
}

/** Candidates for the text cleanup in Settings: every article older than `minDays` that is not protected, biggest first. Pure. */
export function textCleanupIds(index, { minDays = OLD_DAYS, keep = new Set(), now = Date.now() } = {}) {
    return (index || []).filter(a => a && a.id && !a.feedStub && !a.contentPruned && !a.favorite && !keep.has(a.id) && daysUnopened(a, now) >= minDays && estimateBytes(a) >= MIN_CANDIDATE_BYTES / 5).map(a => a.id);
}
