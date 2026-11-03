// graphTagNaming.js — give the archive's tags their English names from the graph, so the same topic in two languages (or two
// spellings) becomes one tag. Uses the existing tag naming (feedAi.js nameTags/applyTagNames → topic lexicon). Only the tag words
// are sent, never article text. A local model is used when one is set up; the result of the first batch is shown before anything
// is saved. Every batch is listed as it comes in, with a progress bar over all of them; rows can be changed or skipped while their
// batch waits, and "check the next 40" asks one batch at a time instead of naming the rest unchecked.
import { T, TN } from './feedI18n.js';
import { el } from './dom.js';
import { unknownTags, isLanguageTag, needsBroader, conceptKey, labelOfKey, humanizeTag, isJunkTag, getLexicon, setLexicon, filterBroader, normalizeTopic } from './topicConcepts.js';
import { isCategory } from './topicCategories.js';

export const NAMING_BATCH = 40;
const isMark = (t) => isCategory(t) || isLanguageTag(t) || isJunkTag(t) || String(t).toLowerCase() === 'general';   // never sent to be named

/** Tags of these articles that have no English name yet (not built in, not learned), most used first; no categories, no language marks. */
export function tagsToName(articles) {
    const all = [];
    (articles || []).forEach(a => (a && a.tags || []).forEach(t => { if (!isMark(t)) all.push(t); }));
    return unknownTags(all, Infinity, 1);
}


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

/**
 * The language each tag is written in: the summary language of most of its articles (the last language mark, "🌐 de"). Tags are
 * written in the summary language, so this tells the model which way to translate. Older articles without marks say nothing.
 */
export function tagLanguagesOf(articles) {
    const votes = new Map();
    (articles || []).forEach(a => {
        const marks = (a && a.tags || []).filter(isLanguageTag);
        if (!marks.length) return;
        const lang = String(marks[marks.length - 1]).replace(/^🌐\s*/, '').trim().toLowerCase();
        (a.tags || []).forEach(t => { if (isMark(t)) return; const v = votes.get(t) || new Map(); v.set(lang, (v.get(lang) || 0) + 1); votes.set(t, v); });
    });
    const out = new Map();
    votes.forEach((v, t) => { const all = [...v.values()].reduce((x, y) => x + y, 0); const [lang, c] = [...v].sort((x, y) => y[1] - x[1])[0]; if (c * 2 > all) out.set(t, lang); });
    return out;
}

/** Tags written in English: most of their articles have an English summary (the last language mark, see content/finalize.js). */
export function englishTagsOf(articles) {
    const votes = new Map();
    (articles || []).forEach(a => {
        const marks = (a && a.tags || []).filter(isLanguageTag);
        if (!marks.length) return;   // older articles without language marks: unknown
        const en = /\ben$/i.test(String(marks[marks.length - 1]).trim());
        (a.tags || []).forEach(t => { if (isMark(t)) return; const v = votes.get(t) || [0, 0]; v[en ? 0 : 1]++; votes.set(t, v); });
    });
    return new Set([...votes].filter(([, [en, other]]) => en > other).map(([t]) => t));
}

/** The archive's most used topics in English: the model picks broader topics from these, so they meet the tags that exist. */
export function broaderVocabOf(articles, max = 60) {
    const n = new Map();
    const sample = new Map();   // a spelling per topic, to write "ProductDesign" as "Product Design" when no English label is known
    (articles || []).forEach(a => (a && a.tags || []).forEach(t => { if (!isMark(t)) { const k = conceptKey(t); n.set(k, (n.get(k) || 0) + 1); if (!sample.has(k)) sample.set(k, t); } }));
    return [...n.entries()].sort((x, y) => y[1] - x[1]).slice(0, max)
        .map(([k]) => labelOfKey(k, 'en') || (String(k).startsWith('c:') ? '' : (sample.get(k) ? humanizeTag(sample.get(k)) : k))).filter(Boolean);
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
    const english = englishTagsOf(articles);   // their English name must be themselves (keepLiteral in feedAi.js)
    const langs = tagLanguagesOf(articles);    // sent with each tag, so a German tag is translated, not repeated
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
    // progress over the whole run: every batch counts, not only the first
    const prog = el('div', 'graph-naming-progress'); prog.hidden = true;
    const meter = el('progress', 'graph-naming-meter'); meter.max = Math.max(1, todo.length); meter.value = 0;
    const count = el('span', 'graph-naming-count');
    prog.append(meter, count);
    const preview = el('ol', 'graph-naming-preview');
    const actions = el('div', 'graph-cluster-actions');
    const mk = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
    const tryBtn = mk('button-primary graph-naming-try', TN(Math.min(NAMING_BATCH, todo.length), 'Try {n} tag', 'Try {n} tags'));
    const saveAll = mk('button-primary graph-naming-save-all', '');
    const saveNext = mk('button-secondary graph-naming-save-next', '');
    const saveFirst = mk('button-secondary graph-naming-save-first', T('Save these only'));
    const stop = mk('button-secondary graph-naming-stop', T('Stop'));
    const undo = mk('button-secondary graph-naming-undo', T('Undo'));
    [saveAll, saveNext, saveFirst, stop, undo].forEach(b => { b.hidden = true; });
    actions.append(tryBtn, saveAll, saveNext, saveFirst, stop, undo);
    const editHint = el('p', 'graph-preview-date graph-naming-edit-hint', T('You can change a name or its broader topics in the row, or skip a row: a skipped tag is not saved and is asked again next time. After saving, the names stay editable in Settings → On-device tools → Learned tag names.'));
    editHint.hidden = true;
    // names learned earlier that look wrong: one topic under two names, or a tag just repeated in its own language
    const tidyMod = deps.tidy || await import('./lexiconEditor.js');
    const plan = tidyMod.tidyPlan(langs);
    const tidyRow = el('div', 'graph-naming-tidy');
    if (plan.duplicates.length || plan.untranslated.length) {
        const txt = [plan.duplicates.length ? TN(plan.duplicates.length, '{n} learned name is a duplicate', '{n} learned names are duplicates') : '',
            plan.untranslated.length ? TN(plan.untranslated.length, '{n} is not translated', '{n} are not translated') : ''].filter(Boolean).join(' · ');
        const tidyBtn = mk('button-secondary graph-naming-tidy-btn', T('Tidy up first'));
        tidyBtn.title = T('Merge the duplicates and forget the untranslated names, so they are named again here');
        tidyRow.append(el('span', 'graph-preview-date', txt), tidyBtn);
        tidyBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); tidyBtn.disabled = true;
            tidyMod.tidyLexicon(langs); await save();
            onDone(0);
            close();
            await openTagNamingPage(container, { articles, onDone }, deps);   // the counts change: start over with what is left
        });
    } else tidyRow.hidden = true;
    body.append(what, why, tidyRow, actions, prog, status, editHint, preview);
    page.append(bar, body);
    let close = () => {};
    let ctl = null;
    back.addEventListener('click', (e) => { e.stopPropagation(); if (ctl) ctl.abort(); close(); });
    close = mountPage(container, page, T('Name tags with AI'), () => { if (ctl) ctl.abort(); });

    if (!todo.length) { status.textContent = T('Every tag already has a name.'); tryBtn.hidden = true; return { page, close }; }

    const batches = [];
    for (let i = 0; i < todo.length; i += NAMING_BATCH) batches.push(todo.slice(i, i + NAMING_BATCH));
    let next = 0, done = 0, named = 0;   // next batch to ask, tags handled so far, tags saved with a name
    let current = null;                  // the batch on screen waiting to be checked: { batch, rows, code }
    const say = (t, kind = '') => { status.className = 'graph-cluster-answer' + (kind ? ' is-' + kind : ''); status.textContent = t; };
    const fail = (e) => { if (e && (e.cancelled || e.name === 'AbortError')) { say(T('Stopped.')); return; } say((e && e.message) || T('AI request failed'), 'error'); };
    const showProgress = () => { prog.hidden = false; meter.value = done; count.textContent = T('{a} of {b} tags', { a: done, b: todo.length }); };
    const left = () => todo.length - done - (current ? current.batch.length : 0);

    // the broader topics as they will be saved (categories, catch-alls and the tag itself dropped), in the model's spelling
    const shownBroader = (n) => {
        if (!n || !n.en) return [];
        const keep = new Set(filterBroader(n.en, n.broader));
        return (n.broader || []).filter((b, i, all) => keep.has(normalizeTopic(b)) && all.findIndex(x => normalizeTopic(x) === normalizeTopic(b)) === i);
    };
    const splitList = (v) => String(v || '').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
    // one row: editable while its batch waits to be checked, plain text once saved
    const makeRow = (t, n, code) => {
        const fresh = isNew.has(t);
        const li = el('li', 'graph-naming-row' + (n && n.en ? '' : ' is-skipped'));
        const tag = el('span', 'graph-naming-tag', t);
        const enIn = el('input', 'graph-naming-en-input'); enIn.type = 'text'; enIn.maxLength = 40; enIn.value = n && n.en ? n.en : ''; enIn.placeholder = T('(no name)'); enIn.setAttribute('aria-label', T('English name of {tag}', { tag: t }));
        const uiIn = el('input', 'graph-naming-ui-input'); uiIn.type = 'text'; uiIn.maxLength = 40; uiIn.value = n && n.ui ? n.ui : ''; uiIn.placeholder = T('in your language'); uiIn.setAttribute('aria-label', T('Name of {tag} in your language', { tag: t }));
        const brIn = el('input', 'graph-naming-broader-input'); brIn.type = 'text'; brIn.value = shownBroader(n).join(', '); brIn.placeholder = T('broader topics, comma separated'); brIn.setAttribute('aria-label', T('Broader topics of {tag}', { tag: t }));
        const skipLbl = el('label', 'graph-naming-skip'); const skip = el('input'); skip.type = 'checkbox'; skip.className = 'graph-naming-skip-box';
        skip.checked = fresh && !(n && n.en);   // nothing to save: skipped until a name is typed
        skipLbl.append(skip, document.createTextNode(' ' + T('Skip')));
        enIn.addEventListener('input', () => { if (enIn.value.trim()) skip.checked = false; li.classList.toggle('is-skipped', skip.checked); });
        skip.addEventListener('change', () => li.classList.toggle('is-skipped', skip.checked));
        li.append(tag, el('span', 'graph-naming-arrow', '→'));
        if (fresh) {
            li.append(enIn); if (code !== 'en') li.append(uiIn);
            if (n && n.kept) li.append(el('span', 'graph-naming-note', T('(literal; the model had a broader word)')));
            if (n && n.same) { li.classList.add('is-same'); li.append(el('span', 'graph-naming-note', n.same === 'en' ? T('(not translated, even when asked again: a name? Change it if not)') : T('(no translation in your language: change it if there is one)'))); }
        }
        else li.append(el('span', 'graph-naming-en', T('(name kept)')));
        const brWrap = el('span', 'graph-naming-broader-wrap'); brWrap.append(el('span', 'graph-naming-broader-lbl', T('broader:')), brIn);
        li.append(skipLbl, brWrap);
        // what is saved for this row: null = skipped (nothing learned, asked again next time)
        const read = () => {
            if (skip.checked) return null;
            const en = fresh ? normalizeTopic(enIn.value) : (n && n.en) || '';
            if (fresh && !en) return null;
            return { en, ui: uiIn.value.trim() || null, broader: splitList(brIn.value) };
        };
        // after saving: the same row as text
        const freeze = () => {
            const r = read();
            li.textContent = '';
            li.className = 'graph-naming-row' + (r ? '' : ' is-skipped');
            const br = r ? filterBroader(r.en, r.broader) : [];
            li.append(el('span', 'graph-naming-tag', t), el('span', 'graph-naming-arrow', '→'),
                el('span', 'graph-naming-en', !r ? T('(skipped)') : fresh ? r.en : T('(name kept)')),
                ...(r && fresh && r.ui ? [el('span', 'graph-naming-ui', r.ui)] : []),
                ...(br.length ? [el('span', 'graph-naming-broader', T('broader: {list}', { list: br.join(', ') }))] : []));
        };
        return { li, read, freeze };
    };
    const ask = async (batch) => {
        const r = await ai.nameTags(batch, { signal: ctl.signal, service: route.service, broaderVocab: vocab, english, langs });
        return { batch, code: r.code, names: r.names };
    };
    // a named tag only gets broader topics, a new one its name too; skipped rows are left out entirely
    const applyRows = (batch, names, code) => {
        const a = [], an = [], b = [], bn = [];
        batch.forEach((t, k) => { if (!names[k]) return; if (isNew.has(t)) { a.push(t); an.push(names[k]); } else { b.push(t); bn.push(names[k]); } });
        return (a.length ? ai.applyTagNames(a, an, code) : 0) + (b.length ? ai.applyBroader(b, bn) : 0);
    };
    let before = null;   // the lexicon before the first save, for Undo
    const saveRows = async (batch, names, code) => {
        if (before === null) before = JSON.stringify(getLexicon());
        named += applyRows(batch, names, code);
        await save();   // after each batch: stopping keeps what is done
        done += batch.length;
        showProgress();
    };
    // the batch on screen, checked by the user: saved with their changes
    const saveCurrent = async () => {
        const c = current; current = null;
        await saveRows(c.batch, c.rows.map(r => r.read()), c.code);
        c.rows.forEach(r => r.freeze());
    };
    const showBatch = (res) => {
        const rows = res.batch.map((t, k) => makeRow(t, res.names[k], res.code));
        rows.forEach(r => preview.append(r.li));
        current = { batch: res.batch, rows, code: res.code };
        editHint.hidden = false;
        if (next > 1 && rows[0] && rows[0].li.scrollIntoView) rows[0].li.scrollIntoView({ block: 'nearest' });
        return rows;
    };
    // the choices while a batch waits: save and go on blind, save and check the next one, or save only this one
    const offerChoices = () => {
        const rest = left();
        const ok = current.rows.filter(r => r.read()).length;
        say(T('{a} of {b} tags got a name. Check them, change what is wrong, then save.', { a: ok, b: current.batch.length }));
        saveFirst.hidden = false; saveFirst.disabled = false;
        saveFirst.textContent = rest ? T('Save these only') : T('Save');
        saveAll.hidden = !rest; saveAll.disabled = false;
        saveNext.hidden = !rest; saveNext.disabled = false;
        if (rest) {
            saveAll.textContent = TN(rest, 'Save and name the other {n}', 'Save and name the other {n}');
            saveNext.textContent = TN(Math.min(NAMING_BATCH, rest), 'Save and check the next {n}', 'Save and check the next {n}');
        }
    };
    const hideChoices = () => { [saveAll, saveNext, saveFirst].forEach(b => { b.hidden = true; }); };
    const offerUndo = () => {
        undo.hidden = false;
        undo.onclick = async (ev) => {
            ev.stopPropagation(); if (ctl) ctl.abort();
            setLexicon(JSON.parse(before)); await save();
            undo.hidden = true; stop.hidden = true; hideChoices();
            say(T('Undone: the tag names are as they were before.'));
            onDone(0);
        };
    };
    const askNext = async () => {
        ctl = new AbortController();
        const batch = batches[next++];
        say(done ? T('Naming tags… {a} of {b}', { a: done, b: todo.length }) : TN(batch.length, 'Naming {n} tag…', 'Naming {n} tags…'), 'busy');
        return ask(batch);
    };

    tryBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); tryBtn.disabled = true;
        showProgress();
        try { showBatch(await askNext()); tryBtn.hidden = true; offerChoices(); }
        catch (err) { next--; tryBtn.disabled = false; fail(err); }
    });
    saveFirst.addEventListener('click', async (e) => {
        e.stopPropagation(); hideChoices();
        const n0 = named; await saveCurrent();
        say(TN(named - n0, '{n} tag named and saved.', '{n} tags named and saved.'));
        offerUndo();
        onDone(named);
    });
    // check every batch: save this one, ask the next and wait again
    saveNext.addEventListener('click', async (e) => {
        e.stopPropagation(); hideChoices();
        await saveCurrent(); offerUndo(); onDone(named); stop.hidden = false;
        stop.onclick = (ev) => { ev.stopPropagation(); if (ctl) ctl.abort(); };
        try { showBatch(await askNext()); offerChoices(); }
        catch (err) { fail(err); say(T('{a} of {b} tags named and saved before it stopped.', { a: named, b: todo.length }), 'error'); }
        stop.hidden = true;
    });
    // the rest without checking: each batch is listed as it is saved, the bar shows how far it got
    saveAll.addEventListener('click', async (e) => {
        e.stopPropagation(); hideChoices(); stop.hidden = false;
        await saveCurrent(); offerUndo();
        stop.onclick = (ev) => { ev.stopPropagation(); if (ctl) ctl.abort(); };
        try {
            while (next < batches.length) {
                const res = await askNext();
                const rows = res.batch.map((t, k) => makeRow(t, res.names[k], res.code));
                await saveRows(res.batch, rows.map(r => r.read()), res.code);
                rows.forEach(r => { r.freeze(); preview.append(r.li); });
                say(T('Naming tags… {a} of {b}', { a: done, b: todo.length }), 'busy');
            }
            say(T('{a} of {b} tags named and saved.', { a: named, b: todo.length }));
        } catch (err) { fail(err); say(T('{a} of {b} tags named and saved before it stopped.', { a: named, b: todo.length }), 'error'); }
        stop.hidden = true;
        onDone(named);
    });
    return { page, close };
}
