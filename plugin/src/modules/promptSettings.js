// promptSettings.js — Settings › Prompts.
//   Tab 1 "Full articles": preset / guided builder / hand-written prompt for page summaries.
//   Tab 2 "Feeds & briefings": style preferences for AI briefings and week/month recaps.
// Article prompt storage keeps the old keys (prompt, presetPrompt, promptType) so content.js is unchanged;
// the builder adds promptBuilder. Feed style lives in sync storage `feedPromptCfg`.

import { T } from './feedI18n.js';
import { aiComplete, generateRecap } from './feedAi.js';
import {
    ARTICLE_FOCUS, ARTICLE_DEFAULTS, FEED_FOCUS, FEED_DEFAULTS, PHIL_MIX,
    normalizeBuilder, buildArticlePrompt, buildFeedStyle
} from './promptBuilder.js';

import { escapeHtml as esc } from './textUtils.js';
const stripTags = h => { try { return new DOMParser().parseFromString(String(h), 'text/html').body.textContent.trim(); } catch (e) { return String(h); } };

const SAMPLE_ARTICLE = 'City builds a rooftop network of 40 community gardens. The program, started in 2023, turns unused roofs into vegetable gardens run by neighbors. '
    + 'Organizers report that 1,200 households now take part and that the gardens cut summer roof temperatures by about 4 °C. '
    + '“We expected tomato plants, we got a whole new way of knowing our neighbors,” said coordinator Mara Lindt. '
    + 'Critics worry about maintenance costs, which the city estimates at 2 million euros a year.';
const SAMPLE_ITEMS = [
    { title: 'City turns 40 rooftops into community gardens', snippet: '1,200 households take part; roofs run about 4 °C cooler.', source: 'Metro Daily' },
    { title: 'Transit fares to rise 5% in January', snippet: 'Council cites energy costs; riders push back.', source: 'City Wire' },
    { title: 'New study links urban gardens to lower stress', snippet: 'Researchers tracked 600 residents over two years.', source: 'Science Now' }
];

let root = null;
let presets = [];
const S = {
    tab: 'articles',
    art: { type: 'preset', preset: 'Default', builder: normalizeBuilder(null, ARTICLE_DEFAULTS), text: '', customText: '', open: false },
    scope: 'briefing',
    feed: { briefing: { mode: 'builder', builder: normalizeBuilder(null, FEED_DEFAULTS), text: '' }, recap: null, open: false },
    test: { articles: '', feeds: '', busy: false }
};

/* ── storage ── */
async function load() {
    const d = await chrome.storage.sync.get(['prompt', 'presetPrompt', 'promptType', 'promptBuilder', 'promptCustomText', 'feedPromptCfg']).catch(() => ({}));
    const stored = String(d.prompt || '');
    let type = d.promptType === 'builder' || d.promptType === 'custom' ? d.promptType : 'preset';
    // Migration: a prompt that is not (or no longer) one of the presets is the user's own text — keep it as "Custom",
    // untouched. Covers installs from before promptType existed and presets whose wording changed.
    if (type === 'preset' && stored.trim() && presets.length) {
        const p = presets.find(x => x.name === d.presetPrompt);
        if (!p || p.prompt !== stored) {
            type = 'custom';
            chrome.storage.sync.set({ promptType: 'custom', presetPrompt: 'custom', promptCustomText: stored }).catch(() => {});
        }
    }
    S.art.type = type;
    S.art.preset = type === 'preset' ? (d.presetPrompt && d.presetPrompt !== 'custom' && d.presetPrompt !== 'builder' ? d.presetPrompt : 'Default') : (S.art.preset || 'Default');
    S.art.builder = normalizeBuilder(d.promptBuilder, ARTICLE_DEFAULTS);
    S.art.text = stored;
    S.art.customText = d.promptCustomText || (type === 'custom' ? stored : '');
    const cfg = d.feedPromptCfg || {};
    const norm = x => x && (x.mode === 'custom' || x.mode === 'builder')
        ? { mode: x.mode, builder: normalizeBuilder(x.builder, FEED_DEFAULTS), text: String(x.text || '') } : null;
    S.feed.briefing = norm(cfg.briefing) || { mode: 'builder', builder: normalizeBuilder(null, FEED_DEFAULTS), text: '' };
    S.feed.recap = norm(cfg.recap);
}

function saveArticle() {
    const a = S.art;
    if (a.type === 'builder') {
        a.text = buildArticlePrompt(a.builder);
        return chrome.storage.sync.set({ promptType: 'builder', presetPrompt: 'builder', promptBuilder: a.builder, prompt: a.text, promptCustomText: a.customText || '' });
    }
    if (a.type === 'custom') { a.customText = a.text; return chrome.storage.sync.set({ promptType: 'custom', presetPrompt: 'custom', prompt: a.text, promptCustomText: a.text }); }
    const p = presets.find(x => x.name === a.preset);
    if (p) a.text = p.prompt;
    return chrome.storage.sync.set({ promptType: 'preset', presetPrompt: a.preset, prompt: a.text, promptCustomText: a.customText || '' });
}

function saveFeed() {
    return chrome.storage.sync.set({ feedPromptCfg: { briefing: S.feed.briefing, recap: S.feed.recap } });
}

const curFeed = () => (S.scope === 'recap' && S.feed.recap) ? S.feed.recap : S.feed.briefing;
const feedTextOf = st => st.mode === 'custom' ? st.text : buildFeedStyle(st.builder);

/* ── rendering ── */
function seg(name, items, active) {
    return `<div class="ps-seg" role="group">${items.map(([v, label]) =>
        `<button type="button" class="ps-seg-btn${v === active ? ' on' : ''}" data-act="${name}" data-v="${esc(v)}" aria-pressed="${v === active}">${esc(label)}</button>`).join('')}</div>`;
}
function chips(name, defs, on, labels) {
    return `<div class="ps-chips">${defs.map(f =>
        `<button type="button" class="pill${on.includes(f.id) ? ' on' : ''}" data-act="${name}" data-v="${f.id}" aria-pressed="${on.includes(f.id)}">${esc(labels[f.id])}</button>`).join('')}</div>`;
}

const TONE_LABELS = () => [['neutral', T('Neutral')], ['casual', T('Casual')], ['formal', T('Formal')]];
const LEN_LABELS = () => [['short', T('Short')], ['medium', T('Medium')], ['long', T('Long')]];
const ART_LABELS = () => ({
    facts: T('Key facts'), numbers: T('Numbers'), opinions: T('Opinions'), actions: T('Action items'),
    title: T('Creative title'), quotes: T('Key quotes'), ux: T('UX designer reference'), standup: T('Standup humor'), media: T('Book & media tips'), style: T('Emojis & hashtags')
});
const FEED_LABELS = () => ({ facts: T('Hard facts'), numbers: T('Numbers'), impact: T('Why it matters'), humor: T('Light humor') });

function testBox(kind) {
    const out = S.test[kind];
    return `<div class="ps-actions">
        <button type="button" class="button-secondary btn-md" data-act="reset">${esc(T('Reset'))}</button>
        <button type="button" class="button-primary btn-md" data-act="test"${S.test.busy ? ' disabled' : ''}>${esc(S.test.busy ? T('Testing…') : T('Test on sample'))}</button>
      </div>${out ? `<div class="ps-test" id="psTestOut">${esc(out)}</div>` : ''}`;
}

function articlesHtml() {
    const a = S.art;
    const sel = a.type === 'preset' ? a.preset : a.type;
    const opts = [`<option value="builder"${sel === 'builder' ? ' selected' : ''}>${esc(T('✨ Build my own'))}</option>`]
        .concat(presets.map(p => `<option value="${esc(p.name)}"${sel === p.name ? ' selected' : ''}>${esc(p.name)}</option>`))
        .concat([`<option value="custom"${sel === 'custom' ? ' selected' : ''}>${esc(T('Custom'))}</option>`]);
    const L = ART_LABELS();
    let h = `<p class="ps-hint">${esc(T('Used whenever you summarize a page or article.'))}</p>
      <label class="ps-label" for="promptSelect">${esc(T('Preset'))} <a href="https://github.com/philffm/ai-summary-helper/blob/main/src/prompts.json" target="_blank" rel="noopener">${esc(T('(View all & contribute)'))}</a></label>
      <select id="promptSelect" class="ps-select">${opts.join('')}</select>`;
    if (a.type === 'builder') {
        const b = a.builder;
        h += `<div class="ps-group"><span class="ps-label">${esc(T('Tone'))}</span>${seg('tone', TONE_LABELS(), b.tone)}</div>
      <div class="ps-group"><span class="ps-label">${esc(T('Length'))}</span>${seg('length', LEN_LABELS(), b.length)}</div>
      <div class="ps-group"><span class="ps-label">${esc(T('Focus on'))}</span>${chips('focus', ARTICLE_FOCUS.filter(f => f.group === 'focus'), b.focus, L)}</div>
      <div class="ps-group"><span class="ps-label">${esc(T('Extras'))} <button type="button" class="ps-link" data-act="phil">${esc(T('✨ Phil’s mix'))}</button></span>${chips('focus', ARTICLE_FOCUS.filter(f => f.group === 'extras'), b.focus, L)}</div>
      <div class="ps-group"><label class="ps-label" for="psExtra">${esc(T('Extra instructions'))}</label>
        <textarea id="psExtra" class="ps-text short" placeholder="${esc(T('e.g. Always name the author and publication.'))}">${esc(b.extra)}</textarea></div>`;
    }
    const manual = a.type !== 'builder';
    h += `<button type="button" class="ps-row" data-act="toggleFull"><span>${esc(T('Full prompt'))}</span><span class="ps-link">${esc(a.open || manual ? T('Hide ⌃') : T('View & edit ›'))}</span></button>`;
    if (a.open || manual) {
        h += `<textarea id="prompt" class="ps-text" placeholder="${esc(T('Enter your custom prompt here...'))}">${esc(a.text)}</textarea>`;
        if (a.type === 'custom') h += `<div class="ps-note warn">${esc(T('✏️ Edited by hand — the chips won’t change it until you go back to the builder.'))} <button type="button" class="ps-link" data-act="toBuilder">${esc(T('Back to builder'))}</button></div>`;
    }
    h += `<div class="ps-note">${esc(T('🔒 Tags, key highlights and the mood score are always added automatically — you only control the style.'))}</div>`;
    return h + testBox('articles');
}

function feedsHtml() {
    const st = curFeed();
    const L = FEED_LABELS();
    const sameAsBriefing = S.scope === 'recap' && !S.feed.recap;
    let h = `<p class="ps-hint">${esc(T('Style for AI briefings and week & month recaps.'))}</p>
      <div class="ps-group"><span class="ps-label">${esc(T('Edit style for'))}</span>${seg('scope', [['briefing', T('Daily briefing')], ['recap', T('Week & month recaps')]], S.scope)}</div>`;
    if (S.scope === 'recap') {
        h += `<button type="button" class="ps-row toggle${sameAsBriefing ? ' on' : ''}" data-act="sameToggle" role="switch" aria-checked="${sameAsBriefing}"><span>${esc(T('Same style as the daily briefing'))}</span><span class="ps-switch"><span class="ps-knob"></span></span></button>`;
    }
    if (!sameAsBriefing) {
        if (st.mode === 'builder') {
            const b = st.builder;
            h += `<div class="ps-group"><span class="ps-label">${esc(T('Tone'))}</span>${seg('tone', TONE_LABELS(), b.tone)}</div>
          <div class="ps-group"><span class="ps-label">${esc(T('Length'))}</span>${seg('length', LEN_LABELS(), b.length)}</div>
          <div class="ps-group"><span class="ps-label">${esc(T('Include'))}</span>${chips('ffocus', FEED_FOCUS, b.focus, L)}</div>
          <div class="ps-group"><label class="ps-label" for="psExtra">${esc(T('Extra instructions'))}</label>
            <textarea id="psExtra" class="ps-text short" placeholder="${esc(T('e.g. Prefer European news and keep it upbeat.'))}">${esc(b.extra)}</textarea></div>`;
        }
        const manual = st.mode === 'custom';
        h += `<button type="button" class="ps-row" data-act="toggleFull"><span>${esc(T('Full style text'))}</span><span class="ps-link">${esc(S.feed.open || manual ? T('Hide ⌃') : T('View & edit ›'))}</span></button>`;
        if (S.feed.open || manual) {
            h += `<textarea id="psFeedText" class="ps-text">${esc(feedTextOf(st))}</textarea>`;
            if (manual) h += `<div class="ps-note warn">${esc(T('✏️ Edited by hand — the chips won’t change it until you go back to the builder.'))} <button type="button" class="ps-link" data-act="toBuilder">${esc(T('Back to builder'))}</button></div>`;
        }
    }
    h += `<div class="ps-note">${esc(T('Briefings and recaps keep their fixed layout (overview, themes, mood) — these settings only change tone and wording.'))}</div>`;
    return h + testBox('feeds');
}

function render() {
    if (!root) return;
    root.innerHTML = `<p class="ps-intro">${esc(T('Customize how the AI writes.'))}</p>
      ${seg('tab', [['articles', T('📄 Full articles')], ['feeds', T('📰 Feeds & briefings')]], S.tab)}
      <div class="ps-body">${S.tab === 'articles' ? articlesHtml() : feedsHtml()}</div>`;
}

/* ── actions ── */
function refreshText() {
    const t = root.querySelector(S.tab === 'articles' ? '#prompt' : '#psFeedText');
    if (!t) return;
    t.value = S.tab === 'articles' ? S.art.text : feedTextOf(curFeed());
}

function toggleIn(list, id) { return list.includes(id) ? list.filter(x => x !== id) : [...list, id]; }

async function runTest() {
    if (S.test.busy) return;
    S.test.busy = true; S.test[S.tab] = ''; render();
    try {
        if (S.tab === 'articles') {
            const sys = 'You are a summarizer returning HTML <div> with <h2> and <p> tags. ' + (S.art.text || buildArticlePrompt(S.art.builder));
            S.test.articles = stripTags(await aiComplete(sys, SAMPLE_ARTICLE)).slice(0, 1800);
        } else {
            const r = await generateRecap(SAMPLE_ITEMS, i => i.source, { rate: false, styleText: feedTextOf(curFeed()) });
            S.test.feeds = [r.overview, ...(r.themes || []).map(x => '• ' + x)].filter(Boolean).join('\n');
        }
    } catch (e) {
        S.test[S.tab] = '⚠️ ' + ((e && e.message) || T('AI request failed'));
    }
    S.test.busy = false; render();
}

async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act, v = b.dataset.v;
    const art = S.tab === 'articles';
    if (act === 'tab') { S.tab = v; render(); return; }
    if (act === 'scope') { S.scope = v; render(); return; }
    if (act === 'test') { runTest(); return; }
    if (act === 'toggleFull') { if (art) S.art.open = !S.art.open; else S.feed.open = !S.feed.open; render(); return; }
    if (art) {
        const a = S.art;
        if (act === 'reset') { a.type = 'builder'; a.builder = normalizeBuilder(null, ARTICLE_DEFAULTS); await saveArticle(); render(); return; }
        if (act === 'toBuilder') { a.type = 'builder'; await saveArticle(); render(); return; }
        if (a.type !== 'builder') return;
        if (act === 'tone') a.builder.tone = v;
        else if (act === 'length') a.builder.length = v;
        else if (act === 'focus') a.builder.focus = toggleIn(a.builder.focus, v);
        else if (act === 'phil') a.builder = { ...PHIL_MIX, extra: a.builder.extra };
        else return;
        await saveArticle(); render(); return;
    }
    // feeds
    if (act === 'sameToggle') { S.feed.recap = S.feed.recap ? null : JSON.parse(JSON.stringify(S.feed.briefing)); await saveFeed(); render(); return; }
    const st = curFeed();
    if (act === 'reset') {
        const fresh = { mode: 'builder', builder: normalizeBuilder(null, FEED_DEFAULTS), text: '' };
        if (S.scope === 'recap' && S.feed.recap) S.feed.recap = fresh; else S.feed.briefing = fresh;
        await saveFeed(); render(); return;
    }
    if (act === 'toBuilder') { st.mode = 'builder'; await saveFeed(); render(); return; }
    if (st.mode !== 'builder') return;
    if (act === 'tone') st.builder.tone = v;
    else if (act === 'length') st.builder.length = v;
    else if (act === 'ffocus') st.builder.focus = toggleIn(st.builder.focus, v);
    else return;
    await saveFeed(); render();
}

function onChange(e) {
    if (e.target.id === 'promptSelect') {
        const v = e.target.value;
        if (v === 'builder' || v === 'custom') S.art.type = v;
        else { S.art.type = 'preset'; S.art.preset = v; }
        if (v === 'custom') S.art.text = S.art.customText || S.art.text || '';
        saveArticle().then(render);
    }
}

let tm = null;
function onInput(e) {
    const id = e.target.id;
    clearTimeout(tm);
    if (id === 'psExtra') {
        const st = S.tab === 'articles' ? S.art : curFeed();
        st.builder.extra = e.target.value.slice(0, 800);
        if (S.tab === 'articles') { S.art.text = buildArticlePrompt(S.art.builder); tm = setTimeout(saveArticle, 300); }
        else tm = setTimeout(saveFeed, 300);
        refreshText();
    } else if (id === 'prompt') {
        S.art.type = 'custom'; S.art.text = e.target.value;
        tm = setTimeout(async () => { await saveArticle(); render(); const t = root.querySelector('#prompt'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 600);
    } else if (id === 'psFeedText') {
        const st = curFeed(); st.mode = 'custom'; st.text = e.target.value;
        tm = setTimeout(async () => { await saveFeed(); render(); const t = root.querySelector('#psFeedText'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 600);
    }
}

export async function initPromptSettings(rootEl) {
    root = rootEl || document.getElementById('promptSettingsRoot');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    try { presets = await (await fetch('prompts.json')).json(); } catch (e) { presets = []; }
    await load();
    render();
}
