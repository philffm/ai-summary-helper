// lexiconEditor.js — the learned tag names (topic lexicon, see topicConcepts.js) as a list in the settings: change an English name or
// its broader topics after saving, or forget an entry (its tags then count as unnamed again and can be named anew).
// Only the lexicon changes; articles keep their tags.
import { T, TN } from './feedI18n.js';
import { getLexicon, setLexicon, normalizeTopic, filterBroader } from './topicConcepts.js';

const SHOW = 60;   // rows shown at once; more on request (an archive can have well over a thousand)

/** The learned entries, newest names last as stored: { key, en, labels: { locale: label }, spellings, broader }. */
export function learnedEntries(lex = getLexicon()) {
    return Object.entries(lex || {}).map(([key, e]) => {
        const labels = {};
        Object.entries(e || {}).forEach(([k, v]) => { if (k !== '*' && k !== '>' && typeof v === 'string') labels[k] = v; });
        return { key, en: labels.en || key, labels, spellings: Array.isArray(e && e['*']) ? e['*'].slice() : [], broader: Array.isArray(e && e['>']) ? e['>'].slice() : null };
    }).sort((a, b) => a.en.localeCompare(b.en));
}

/** Entries matching a search over the name, the other labels, the spellings and the broader topics. */
export function filterEntries(list, q) {
    const n = normalizeTopic(q);
    if (!n) return list;
    return list.filter(e => [e.en, e.key, ...Object.values(e.labels), ...e.spellings, ...(e.broader || [])].some(x => normalizeTopic(x).includes(n)));
}

/**
 * Give an entry another English name. Its spellings, labels and broader topics move with it; when the new name is already a learned
 * topic, both become one. Returns the new key, or null when nothing changed.
 */
export function renameLearned(key, en) {
    const lex = getLexicon(), cur = lex[key];
    const to = normalizeTopic(en), shown = String(en || '').replace(/\s+/g, ' ').trim();
    if (!cur || !to || to.length > 40) return null;
    const label = shown.replace(/^./, c => c.toUpperCase());
    if (to === key) { if (cur.en === label) return null; cur.en = label; setLexicon(lex); return key; }
    const into = lex[to] || {};
    const spellings = [...(into['*'] || []), ...(cur['*'] || [])].filter((s, i, all) => all.findIndex(x => normalizeTopic(x) === normalizeTopic(s)) === i).slice(-12);
    const merged = { ...cur, ...into, en: label, '*': spellings };
    const br = filterBroader(to, [...(into['>'] || []), ...(cur['>'] || [])]);
    if (into['>'] || cur['>']) merged['>'] = br;
    delete lex[key]; lex[to] = merged;
    setLexicon(lex);
    return to;
}

/** Set the broader topics of an entry (as the naming would: categories, catch-alls and the topic itself are dropped). */
export function setLearnedBroader(key, list) {
    const lex = getLexicon(), cur = lex[key];
    if (!cur) return false;
    const out = filterBroader(key, list);
    if (Array.isArray(cur['>']) && cur['>'].join('|') === out.join('|')) return false;
    cur['>'] = out; setLexicon(lex);
    return true;
}

/** Forget an entry: its tags have no English name again. */
export function forgetLearned(key) {
    const lex = getLexicon();
    if (!lex[key]) return false;
    delete lex[key]; setLexicon(lex);
    return true;
}

/** The list in the settings. deps: { save, onChange } (save writes the lexicon, onChange tells the open pages). */
export function mountLexiconEditor(box, { save = async () => {}, onChange = () => {} } = {}) {
    box.textContent = '';
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'lexicon-search'; search.placeholder = T('Search learned names');
    search.setAttribute('aria-label', T('Search learned names'));
    const info = document.createElement('p'); info.className = 'settings-card-note lexicon-info';
    const list = document.createElement('ul'); list.className = 'lexicon-list';
    const more = document.createElement('button'); more.type = 'button'; more.className = 'button-secondary btn-sm lexicon-more';
    box.append(search, info, list, more);
    let shown = SHOW;
    const changed = async () => { await save(); onChange(); };
    const row = (e) => {
        const li = document.createElement('li'); li.className = 'lexicon-row'; li.dataset.key = e.key;
        const tags = document.createElement('span'); tags.className = 'lexicon-tags';
        const others = Object.entries(e.labels).filter(([k]) => k !== 'en').map(([, v]) => v);
        tags.textContent = [...new Set([...e.spellings, ...others])].filter(s => normalizeTopic(s) !== e.key).join(', ') || e.en;
        const en = document.createElement('input'); en.type = 'text'; en.maxLength = 40; en.className = 'lexicon-en'; en.value = e.en;
        en.setAttribute('aria-label', T('English name'));
        const br = document.createElement('input'); br.type = 'text'; br.className = 'lexicon-broader'; br.value = (e.broader || []).join(', ');
        br.placeholder = T('broader topics, comma separated'); br.setAttribute('aria-label', T('Broader topics'));
        const del = document.createElement('button'); del.type = 'button'; del.className = 'button-secondary btn-sm lexicon-forget'; del.textContent = T('Forget');
        del.title = T('Forget this name: its tags count as unnamed again');
        let key = e.key;
        en.addEventListener('change', async () => { const k = renameLearned(key, en.value); if (k) { key = k; li.dataset.key = k; await changed(); } else en.value = (getLexicon()[key] || {}).en || key; });
        br.addEventListener('change', async () => { if (setLearnedBroader(key, br.value.split(/\s*,\s*/).filter(Boolean))) await changed(); br.value = (getLexicon()[key]['>'] || []).join(', '); });
        del.addEventListener('click', async () => { if (forgetLearned(key)) { li.remove(); await changed(); render(false); } });
        const arrow = document.createElement('span'); arrow.className = 'lexicon-arrow'; arrow.textContent = '→';
        li.append(tags, arrow, en, del, br);
        return li;
    };
    const render = (rows = true) => {
        const all = learnedEntries(), hits = filterEntries(all, search.value);
        info.textContent = all.length ? (search.value ? T('{a} of {b} learned names', { a: hits.length, b: all.length }) : TN(all.length, '{n} learned name', '{n} learned names')) : T('No learned names yet.');
        more.hidden = hits.length <= shown;
        more.textContent = TN(hits.length - shown, 'Show {n} more', 'Show {n} more');
        if (!rows) return;
        list.textContent = '';
        hits.slice(0, shown).forEach(e => list.append(row(e)));
    };
    search.addEventListener('input', () => { shown = SHOW; render(); });
    more.addEventListener('click', () => { shown += SHOW; render(); });
    render();
    return { render };
}
