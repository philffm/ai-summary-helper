// graphTagNaming.js — give the archive's tags their English names from the graph, so the same topic in two languages (or two
// spellings) becomes one tag. Uses the existing tag naming (feedAi.js nameTags/applyTagNames → topic lexicon). Only the tag words
// are sent, never article text. A local model is used when one is set up; the result of the first batch is shown before anything
// is saved.
import { T, TN } from './feedI18n.js';
import { el } from './dom.js';
import { unknownTags, isLanguageTag, needsBroader, conceptKey, labelOfKey } from './topicConcepts.js';
import { isCategory } from './topicCategories.js';

export const NAMING_BATCH = 40;

/** Tags of these articles that have no English name yet (not built in, not learned), most used first; no categories, no language marks. */
export function tagsToName(articles) {
    const all = [];
    (articles || []).forEach(a => (a && a.tags || []).forEach(t => { if (!isCategory(t) && !isLanguageTag(t) && String(t).toLowerCase() !== 'general') all.push(t); }));
    return unknownTags(all, Infinity, 1);
}

const isMark = (t) => isCategory(t) || isLanguageTag(t) || String(t).toLowerCase() === 'general';

/** Tags that have a name but were never asked for their broader topics (once per topic, most used first). */
export function tagsToBroaden(articles) {
    const n = new Map();
    (articles || []).forEach(a => (a && a.tags || []).forEach(t => {
        if (isMark(t) || !needsBroader(t)) return;
        const k = conceptKey(t), e = n.get(k) || { tag: t, c: 0 };
        e.c++; n.set(k, e);
    }));
    return [...n.values()].sort((x, y) => y.c - x.c).map(e => e.tag);
}

/** What is left to do: tags with no name, and named ones with no broader topics yet. */
export function namingWork(articles) {
    const unnamed = tagsToName(articles);
    const seen = new Set(unnamed);
    return { unnamed, broaden: tagsToBroaden(articles).filter(t => !seen.has(t)) };
}

/** The archive's most used topics in English: the model picks broader topics from these, so they meet the tags that exist. */
export function broaderVocabOf(articles, max = 60) {
    const n = new Map();
    (articles || []).forEach(a => (a && a.tags || []).forEach(t => { if (!isMark(t)) { const k = conceptKey(t); n.set(k, (n.get(k) || 0) + 1); } }));
    return [...n.entries()].sort((x, y) => y[1] - x[1]).slice(0, max)
        .map(([k]) => labelOfKey(k, 'en') || (String(k).startsWith('c:') ? '' : k)).filter(Boolean);
}

/**
 * Where the request goes. A local connection is used as it is; otherwise Ollama when it has been set up (as the feeds' library run
 * does); otherwise the connection chosen for summaries. `read` is injectable for tests.
 * @returns {Promise<{ service: ''|'ollama', local: boolean, label: string }>}
 */
export async function namingRoute(read = defaultRead) {
    const { sync = {}, services = {} } = await read();
    const ollama = services.ollama || {};
    const ollamaSaved = !!(ollama.endpoint || ollama.endpointUrl || ollama.activeModelId || (Array.isArray(ollama.customModel) ? ollama.customModel.length : ollama.customModel));
    if (sync.connectionMode === 'local') return { service: '', local: true, label: T('your local model ({name})', { name: sync.activeService || 'local' }) };
    if (ollamaSaved) return { service: 'ollama', local: true, label: T('your local model ({name})', { name: 'Ollama' }) };
    return { service: '', local: false, label: T('the connection you use for summaries') };
}
async function defaultRead() {
    const [sync, local] = await Promise.all([
        new Promise(r => chrome.storage.sync.get(['connectionMode', 'activeService'], r)),
        import('./storageKeys.js').then(({ SK }) => new Promise(r => chrome.storage.local.get(SK.servicesConfig, (d) => r((d && d[SK.servicesConfig]) || {}))))
    ]);
    return { sync: sync || {}, services: local || {} };
}

/**
 * The page over the graph. deps (injectable for tests): { mountPage, ai: { nameTags, applyTagNames }, saveLexicon, route }.
 * onDone(named) is called after something was saved, so the graph can redraw with the new names.
 */
export async function openTagNamingPage(container, { articles, onDone = () => {} }, deps = {}) {
    const ai = deps.ai || await import('./feedAi.js');
    const save = deps.saveLexicon || (await import('./topicLexicon.js')).saveLexicon;
    const mountPage = deps.mountPage || (await import('./graphClusters.js')).mountGraphPage;
    const route = deps.route || await namingRoute();
    const { unnamed, broaden } = namingWork(articles);
    const todo = [...unnamed, ...broaden];
    const isNew = new Set(unnamed);
    const vocab = broaderVocabOf(articles);
    // a tag with no name is named (and gets broader topics); a named one only gets broader topics, its name stays
    const applyBatch = (batch, names, code) => {
        const a = [], an = [], b = [], bn = [];
        batch.forEach((t, k) => { if (isNew.has(t)) { a.push(t); an.push(names[k]); } else { b.push(t); bn.push(names[k]); } });
        return (a.length ? ai.applyTagNames(a, an, code) : 0) + (b.length ? ai.applyBroader(b, bn) : 0);
    };

    const page = el('div', 'graph-cluster-page graph-naming-page');
    const bar = el('div', 'graph-cluster-bar');
    const back = el('button', 'graph-cluster-back', '←'); back.type = 'button'; back.setAttribute('aria-label', T('Back'));
    const ttl = el('div', 'graph-cluster-ttl');
    ttl.append(el('strong', 'graph-cluster-title', T('Name tags with AI')), el('div', 'graph-preview-date', [unnamed.length ? TN(unnamed.length, '{n} tag has no English name yet', '{n} tags have no English name yet') : '', broaden.length ? TN(broaden.length, '{n} named tag has no broader topics yet', '{n} named tags have no broader topics yet') : ''].filter(Boolean).join(' · ') || T('Every tag already has a name.')));
    bar.append(back, ttl);
    const body = el('div', 'graph-cluster-scroll');
    const what = el('p', 'graph-naming-what', T('Only the tag words are sent, no article text. They go to {where}.', { where: route.label }));
    const why = el('p', 'graph-preview-date', T('Each tag gets its English name, so the same topic in two languages, or written two ways, becomes one tag in the graph, search and charts. A specific tag also gets up to two broader topics ("AI in medicine": AI, medicine), so it sits next to them in the graph. Nothing on your articles changes.'));
    const status = el('div', 'graph-cluster-answer'); status.setAttribute('aria-live', 'polite');
    const preview = el('ol', 'graph-naming-preview');
    const actions = el('div', 'graph-cluster-actions');
    const mk = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
    const tryBtn = mk('button-primary graph-naming-try', TN(Math.min(NAMING_BATCH, todo.length), 'Try {n} tag', 'Try {n} tags'));
    const saveAll = mk('button-primary graph-naming-save-all', '');
    const saveFirst = mk('button-secondary graph-naming-save-first', T('Save these only'));
    const stop = mk('button-secondary graph-naming-stop', T('Stop'));
    [saveAll, saveFirst, stop].forEach(b => { b.hidden = true; });
    actions.append(tryBtn, saveAll, saveFirst, stop);
    body.append(what, why, actions, status, preview);
    page.append(bar, body);
    let close = () => {};
    let ctl = null;
    back.addEventListener('click', (e) => { e.stopPropagation(); if (ctl) ctl.abort(); close(); });
    close = mountPage(container, page, T('Name tags with AI'), () => { if (ctl) ctl.abort(); });

    if (!todo.length) { status.textContent = T('Every tag already has a name.'); tryBtn.hidden = true; return { page, close }; }

    const first = todo.slice(0, NAMING_BATCH), rest = todo.slice(NAMING_BATCH);
    let firstNames = null, firstCode = 'en';
    const say = (t, kind = '') => { status.className = 'graph-cluster-answer' + (kind ? ' is-' + kind : ''); status.textContent = t; };
    const fail = (e) => { if (e && (e.cancelled || e.name === 'AbortError')) { say(T('Stopped.')); return; } say((e && e.message) || T('AI request failed'), 'error'); };

    tryBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); tryBtn.disabled = true; ctl = new AbortController();
        say(TN(first.length, 'Naming {n} tag…', 'Naming {n} tags…'), 'busy');
        try {
            const r = await ai.nameTags(first, { signal: ctl.signal, service: route.service, broaderVocab: vocab });
            firstNames = r.names; firstCode = r.code;
            preview.textContent = '';
            first.forEach((t, k) => {
                const n = firstNames[k];
                const li = el('li', 'graph-naming-row' + (n && n.en ? '' : ' is-skipped'));
                li.append(el('span', 'graph-naming-tag', t), el('span', 'graph-naming-arrow', '→'),
                    el('span', 'graph-naming-en', n && n.en ? (isNew.has(t) ? n.en : T('(name kept)')) : T('(no name)')), ...(n && n.ui && isNew.has(t) ? [el('span', 'graph-naming-ui', n.ui)] : []),
                    ...(n && n.broader && n.broader.length ? [el('span', 'graph-naming-broader', T('broader: {list}', { list: n.broader.join(', ') }))] : []));
                preview.append(li);
            });
            const ok = firstNames.filter(n => n && n.en).length;
            say(T('{a} of {b} tags got a name. Check them, then save.', { a: ok, b: first.length }));
            tryBtn.hidden = true;
            saveFirst.hidden = false;
            if (rest.length) { saveAll.hidden = false; saveAll.textContent = TN(rest.length, 'Save and name the other {n}', 'Save and name the other {n}'); }
            else { saveFirst.textContent = T('Save'); }
        } catch (err) { tryBtn.disabled = false; fail(err); }
    });

    const saveFirstBatch = async () => { const n = applyBatch(first, firstNames, firstCode); await save(); return n; };
    saveFirst.addEventListener('click', async (e) => {
        e.stopPropagation(); saveFirst.disabled = true; saveAll.hidden = true;
        const n = await saveFirstBatch();
        say(TN(n, '{n} tag named and saved.', '{n} tags named and saved.'));
        onDone(n);
    });
    saveAll.addEventListener('click', async (e) => {
        e.stopPropagation(); saveAll.disabled = true; saveFirst.hidden = true; stop.hidden = false;
        let named = await saveFirstBatch(), done = first.length;
        ctl = new AbortController();
        stop.onclick = (ev) => { ev.stopPropagation(); if (ctl) ctl.abort(); };
        try {
            for (let i = 0; i < rest.length; i += NAMING_BATCH) {
                const batch = rest.slice(i, i + NAMING_BATCH);
                say(T('Naming tags… {a} of {b}', { a: done, b: todo.length }), 'busy');
                const r = await ai.nameTags(batch, { signal: ctl.signal, service: route.service, broaderVocab: vocab });
                named += applyBatch(batch, r.names, r.code);
                await save();   // after each batch: stopping keeps what is done
                done += batch.length;
            }
            say(T('{a} of {b} tags named and saved.', { a: named, b: todo.length }));
        } catch (err) { fail(err); say(T('{a} of {b} tags named and saved before it stopped.', { a: named, b: todo.length }), 'error'); }
        stop.hidden = true;
        onDone(named);
    });
    return { page, close };
}
