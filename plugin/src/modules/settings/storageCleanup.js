// settings/storageCleanup.js — split out of settingsManager.js (R4 phase 1).
import { confirmSheet } from '../confirmSheet.js';
import { SK } from '../storageKeys.js';
import StorageManager from '../storageManager.js';
import { T } from '../feedI18n.js';
import { autoSave } from './autosave.js';

// ── Section: Storage & cleanup (Library & Data) ───────────────────────
// Frees space without touching the statistics: images and page text go, titles, summaries, tags and highlights stay.
export function initStorageCleanup(storageData = {}) {
    const root = document.getElementById('libStorage');
    if (!root) return;
    const $ = (id) => document.getElementById(id);
    const texts = {
        title: T('Storage & cleanup'),
        saveImages: T('Save images with articles'),
        saveImagesNote: T('Off: new articles keep only the text. Pictures are what makes saved pages large.'),
        imgTitle: T('Remove images from saved articles'), imgBtn: T('Remove images'),
        txtTitle: T('Remove page text of old articles'), txtBtn: T('Remove page text'),
        age: T('Not opened for at least (days)'),
        txtNote: T('Keeps title, summary, tags, highlights and your statistics. Questions about the article then use the summary only. Starred articles and articles in a collection are skipped.'),
        revTitle: T('Review large, unopened articles'), revHint: T('Duplicates and large, unopened articles. Pick what to trim or delete.'), revBtn: T('Review'),
    };
    root.querySelectorAll('[data-t]').forEach(e => { if (texts[e.dataset.t]) e.textContent = texts[e.dataset.t]; });
    const ageSeg = $('storageAgeSeg'); if (ageSeg) ageSeg.setAttribute('aria-label', texts.age);

    const toggle = $('saveImagesToggle');
    if (toggle) {
        toggle.checked = storageData.saveImages !== false;
        toggle.addEventListener('change', () => autoSave('saveImages', toggle.checked));
    }

    let minDays = 90;
    const ageBtns = ageSeg ? [...ageSeg.querySelectorAll('[role=radio]')] : [];
    const paintAge = () => ageBtns.forEach(b => { const on = Number(b.dataset.value) === minDays; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });

    const keepSet = async () => {
        const keep = new Set();
        try {
            const C = await import('../collections.js');
            for (const c of await C.listCollections()) { const rec = await C.getCollection(c.id); (rec ? rec.sources : []).forEach(x => keep.add(x.articleId)); }
        } catch (_) { /* no collections */ }
        return keep;
    };
    const result = (msg) => { const r = $('storageResult'); if (r) { r.textContent = msg; r.style.display = msg ? '' : 'none'; } };
    // Usage bar: images · page text · everything else (summaries, tags, highlights, settings — what the statistics are based on)
    const paintBar = (sh, total, scan) => {
        const bar = $('storageBar'), legend = $('storageLegend'); if (!bar || !legend) return;
        const img = scan.images.bytes, txt = Math.max(0, scan.contentBytes - img), rest = Math.max(0, total - img - txt);
        const sum = img + txt + rest; if (!sum) { bar.hidden = true; legend.hidden = true; return; }
        const [a, b, c] = bar.children;
        a.style.width = (img / sum * 100) + '%'; b.style.width = (txt / sum * 100) + '%'; c.style.width = (rest / sum * 100) + '%';
        const rows = [['storage-bar-img', T('Images'), img], ['storage-bar-txt', T('Page text'), txt], ['storage-bar-rest', T('Summaries, tags, highlights'), rest]];
        bar.hidden = false; legend.hidden = false;
        bar.setAttribute('aria-label', rows.map(([, n, v]) => n + ' ' + sh.formatBytes(v)).join(', '));
        legend.textContent = '';
        rows.forEach(([cls, name, v], i) => {
            const li = document.createElement('li');
            const dot = document.createElement('span'); dot.className = 'storage-dot ' + cls;
            const t = document.createElement('span'); t.textContent = name + ' ' + sh.formatBytes(v);
            li.append(dot, t);
            if (i === 2) { const n = document.createElement('small'); n.textContent = T('Stays — statistics are based on this'); li.append(n); }
            legend.append(li);
        });
    };
    let busy = false;
    const refresh = async () => {
        try {
            const sh = await import('../storageHealth.js');
            const index = await StorageManager.getArticlesIndex({ includeArchived: true });
            const keep = await keepSet();
            const [report, scan] = await Promise.all([sh.measure(index, SK.articlesIndex, keep, { minDays, minBytes: 10 * 1024 }), sh.scanCleanup(index, { minDays, keep })]);
            $('storageUsage').textContent = T('Saved data: {size} · {n} articles', { size: sh.formatBytes(report.totalBytes), n: index.length });
            paintBar(sh, report.totalBytes, scan);
            $('storageImagesHint').textContent = scan.images.n ? T('{n} articles with images · about {size}', { n: scan.images.n, size: sh.formatBytes(scan.images.bytes) }) : T('No saved images.');
            $('storageImagesButton').disabled = !scan.images.n;
            $('storageTextHint').textContent = scan.text.n ? T('{n} articles · about {size}', { n: scan.text.n, size: sh.formatBytes(scan.text.bytes) }) : T('Nothing old enough.');
            $('storageTextButton').disabled = !scan.text.n;
            return { sh, index, keep, report };
        } catch (_) { $('storageUsage').textContent = ''; return null; }
    };
    const guard = (fn) => async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; await refresh(); } };

    ageBtns.forEach((b, i) => {
        b.addEventListener('click', () => { minDays = Number(b.dataset.value) || 90; paintAge(); refresh(); });
        b.addEventListener('keydown', (e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return; e.preventDefault(); const n = ageBtns[(i + d + ageBtns.length) % ageBtns.length]; n.focus(); n.click();
        });
    });
    paintAge();

    $('storageImagesButton')?.addEventListener('click', guard(async () => {
        const ctx = await refresh(); if (!ctx) return;
        if (!(await confirmSheet({ title: T('Remove all saved images?'), text: T('Remove the images from all saved articles? The text stays. This cannot be undone.'), keeps: T('Text, summaries, highlights and notes stay.'), confirmLabel: T('Remove images') }))) return;
        const r = await ctx.sh.removeSavedImages(ctx.index);
        result(T('Images removed from {n} articles · about {size} freed', { n: r.n, size: ctx.sh.formatBytes(r.bytes) }));
    }));
    $('storageTextButton')?.addEventListener('click', guard(async () => {
        const ctx = await refresh(); if (!ctx) return;
        const ids = ctx.sh.textCleanupIds(ctx.index, { minDays, keep: ctx.keep });
        if (!ids.length) return;
        if (!(await confirmSheet({ title: T('Remove saved page text?'), text: T('Remove the saved page text of {n} articles? Summaries and statistics stay. This cannot be undone.', { n: ids.length }), keeps: T('Title, summary, tags, highlights and statistics stay.'), confirmLabel: T('Remove text') }))) return;
        const r = await ctx.sh.dropPageText(ctx.index, ids, SK.articlesIndex);
        result(T('Page text removed from {n} articles · about {size} freed', { n: r.n, size: ctx.sh.formatBytes(r.bytes) }));
    }));
    $('storageReviewButton')?.addEventListener('click', guard(async () => {
        const ctx = await refresh(); if (!ctx) return;
        await ctx.sh.openStorageSheet({
            report: { ...ctx.report, minDays },
            index: ctx.index, keep: ctx.keep,
            deleteIds: async (ids) => { for (const id of ids) await StorageManager.deleteArticle(id); },
            pruneIds: async (ids) => { await ctx.sh.dropPageText(ctx.index, ids, SK.articlesIndex); },
            onDone: (n, how) => result(how === 'pruned' ? T('Page text of {n} articles removed', { n }) : T('{n} articles deleted', { n })),
        });
    }));
    // numbers are read when the panel is opened, not at popup start
    const panel = $('settingsPanel-library');
    if (panel && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (!panel.hidden) refresh(); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    if (panel && !panel.hidden) refresh();   // loaded while the panel was opening (settingsManager loads this section on demand)
}

