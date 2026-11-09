// settings/tagCleanup.js — split out of settingsManager.js (R4 phase 1).
import { SK } from '../storageKeys.js';
import { confirmDestructive } from '../confirmDialog.js';
import StorageManager from '../storageManager.js';
import { buildCanonicalTagMap, applyCanonicalTags } from '../tagIntelligence.js';
import { unknownTags, keysNeedingLabel } from '../topicConcepts.js';
import { loadLexicon, saveLexicon } from '../topicLexicon.js';
import { learnTagNames, translateFeedTopics, uiLanguage } from '../feedAi.js';
import { T, TN } from '../feedI18n.js';

// ── Section: On-Device Intelligence (tag cleanup) ────────────────────
// The per-save tag normalization in content.js only handles known
// alias->canonical mapping. Merging near-duplicate tags that emerged
// organically across the whole archive (typos, "Podcast" vs "Podcasts",
// "ML" vs "Machine Learning") needs the full tag vocabulary, so it runs
// as an explicit, on-demand maintenance pass rather than on every save.
export function initLocalIntelligence() {
    // Link to the Feed library run (Ollama): it belongs with the other tools that run on this machine.
    const libBtn = document.getElementById('libraryToolButton');
    if (libBtn) {
        document.getElementById('libraryToolTitle').textContent = T('Process the Feed library with Ollama');
        document.getElementById('libraryToolHint').textContent = T('Rates, categorizes and recaps all your feed items in small batches on your own machine. No tokens spent.');
        libBtn.textContent = T('Open') + ' →';
        libBtn.addEventListener('click', () => { import('../settingsNav.js').then(m => m.openSettingsPanel('feedprefs', 'feedPrefsLibrary')).catch(() => {}); });
    }
    initNameTags();
    initLearnedNames();
    const btn = document.getElementById('cleanupTagsButton');
    const resultEl = document.getElementById('cleanupTagsResult');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = '🧹 ' + T('Analyzing tags…');
        if (resultEl) resultEl.style.display = 'none';

        try {
            // Tags live entirely in articlesIndex post-migration — this pass
            // never needs to touch per-article content.
            const articles = await StorageManager.getArticlesIndex({ includeArchived: true });

            if (articles.length === 0) {
                if (resultEl) { resultEl.textContent = T('No articles saved yet.'); resultEl.style.display = 'block'; }
                return;
            }

            const canonicalMap = buildCanonicalTagMap(articles);
            let changedArticles = 0;
            let tagsMerged = 0;

            const updated = articles.map(article => {
                const before = article.tags || [];
                const after = applyCanonicalTags(before, canonicalMap);
                const beforeKey = before.map(t => t.toLowerCase()).sort().join('|');
                const afterKey = after.map(t => t.toLowerCase()).sort().join('|');
                if (beforeKey !== afterKey) {
                    changedArticles++;
                    tagsMerged += Math.max(0, before.length - after.length);
                }
                return { ...article, tags: after };
            });

            await StorageManager.setLocal({ [SK.articlesIndex]: updated });

            if (resultEl) {
                resultEl.textContent = changedArticles > 0
                    ? T('✓ Updated {a}, merged {b}.', { a: TN(changedArticles, '{n} article', '{n} articles'), b: TN(tagsMerged, '{n} duplicate tag', '{n} duplicate tags') })
                    : T('✓ Tags already look consistent — nothing to merge.');
                resultEl.style.display = 'block';
            }
        } catch (err) {
            console.error('[AISH] Tag cleanup failed:', err);
            if (resultEl) { resultEl.textContent = T('Something went wrong — please try again.'); resultEl.style.display = 'block'; }
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });
}

/**
 * One-off migration of the tags that already exist: every tag that is neither a built-in topic nor in the learned lexicon
 * is named by the AI (English name + the UI-language word) in blocks of 40 and written to the lexicon only. The articles keep
 * their tags; History, graph and charts then show them in the UI language and group the synonyms. Safe to repeat: a tag is
 * asked once, and a stopped run continues with what is left.
 */
const NAME_TAGS_MIN_USES = 2;
const NAME_TAGS_TIMEOUT_MS = 3 * 60 * 1000;   // per request of 40 tags
function initNameTags() {
    const btn = document.getElementById('nameTagsButton');
    if (!btn) return;
    const title = document.getElementById('nameTagsTitle'), hint = document.getElementById('nameTagsHint'), out = document.getElementById('nameTagsResult');
    title.textContent = T('Name tags in your language');
    hint.textContent = T('Asks your AI connection once for the English name and the UI-language word of every tag that is not known yet and is used at least twice, most used first. Your articles keep their tags.');
    btn.textContent = T('Name tags');
    const say = (m) => { out.textContent = m; out.style.display = 'block'; };
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            await loadLexicon();
            const articles = await StorageManager.getArticlesIndex({ includeArchived: true });
            const all = articles.flatMap(a => a.tags || []);
            // Most used first; a tag that appears only once in the archive is not worth a request (it neither groups nor shows up in charts).
            // Two kinds of work: tags nobody has named yet (English name + UI word), and tags already known in another
            // language that lack a label in the CURRENT UI language (e.g. after switching English → Spanish).
            const { code } = await uiLanguage();
            const unnamed = unknownTags(all, Infinity, NAME_TAGS_MIN_USES);
            const unlabeled = keysNeedingLabel(all, code, Infinity, NAME_TAGS_MIN_USES);
            const total = unnamed.length + unlabeled.length;
            if (!total) { say(T('✓ Every frequently used tag already has a name — nothing to do.')); return; }
            const blocks = [];
            for (let k = 0; k < unnamed.length; k += 40) blocks.push({ list: unnamed.slice(k, k + 40), run: (l, signal) => learnTagNames(l, { signal }) });
            for (let k = 0; k < unlabeled.length; k += 40) blocks.push({ list: unlabeled.slice(k, k + 40), run: async (l, signal) => { await translateFeedTopics(l, { signal }); return l.length; } });
            let named = 0, done = 0, failed = 0, lastError = null;
            // A model that never answers must not look like a frozen button: a clock ticks next to the count and a request
            // gives up after NAME_TAGS_TIMEOUT_MS.
            let line = '', since = 0;
            const tick = setInterval(() => { const t = Math.round((Date.now() - since) / 1000); say(line + ' · ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')); }, 1000);
            try {
                for (const b of blocks) {
                    line = T('Naming tags… {done} of {total}', { done, total }); since = Date.now(); say(line);
                    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), NAME_TAGS_TIMEOUT_MS);
                    try { named += await b.run(b.list, ctl.signal); await saveLexicon(); failed = 0; }
                    catch (e) {
                        lastError = ctl.signal.aborted ? new Error(T('AI request failed') + ' (timeout)') : e;
                        if (++failed >= 2) throw lastError;   // one hiccup is skipped; two in a row stop the run
                    } finally { clearTimeout(timer); }
                    done += b.list.length;
                }
            } finally { clearInterval(tick); }
            document.dispatchEvent(new CustomEvent('aish:lexiconChanged'));
            if (lastError && !named) throw lastError;   // nothing worked: say why instead of "Named 0"
            say(T('✓ Named {n} of {total} tags.', { n: named, total }));
        } catch (err) {
            console.error('[AISH] Tag naming failed:', err);
            document.dispatchEvent(new CustomEvent('aish:lexiconChanged'));
            say(T('Something went wrong — please try again.') + (err && err.message ? ' (' + err.message + ')' : ''));
        } finally { btn.disabled = false; }
    });
}

/** The learned tag names as an editable list (lexiconEditor.js): fix a name or its broader topics after saving, or forget one. */
function initLearnedNames() {
    const btn = document.getElementById('learnedNamesButton'), box = document.getElementById('learnedNamesBox');
    if (!btn || !box) return;
    document.getElementById('learnedNamesTitle').textContent = T('Learned tag names');
    document.getElementById('learnedNamesHint').textContent = T('The English names and broader topics your tags got. Change one, or forget it so it can be named again. Your articles keep their tags.');
    btn.textContent = T('Show');
    let editor = null;
    btn.addEventListener('click', async () => {
        const open = box.hidden;
        box.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? T('Hide') : T('Show');
        if (!open) return;
        await loadLexicon();
        const { mountLexiconEditor } = await import('../lexiconEditor.js');
        const langs = async () => { const { tagLanguagesOf } = await import('../graphTagNaming.js'); return tagLanguagesOf(await StorageManager.getArticlesIndex({ includeArchived: true })); };
        const confirm = (body) => confirmDestructive({ title: T('Forget all learned names?'), body, confirmLabel: T('Forget all') });
        if (!editor) editor = mountLexiconEditor(box, { save: saveLexicon, langs, confirm, onChange: () => document.dispatchEvent(new CustomEvent('aish:lexiconChanged')) });
        else editor.render();
    });
}

