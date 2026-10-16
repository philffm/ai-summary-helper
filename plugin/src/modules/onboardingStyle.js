// onboardingStyle.js — second onboarding step: pick how summaries read, with a live example of each style.
// The examples are written out (no model call: the step must work before anything is configured, and instantly).
// Choosing writes the same keys the Prompt settings use (promptType 'builder'), so the style stays editable there.
import { T as tr } from './feedI18n.js';
import { buildArticlePrompt, normalizeBuilder, normalizeTags, LENSES, MAX_TAGS, MAX_TAG_LENGTH } from './promptBuilder.js';

const T = tr;
// The examples go through innerHTML: translated strings are escaped first.
const E = (k) => tr(k).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** id → guided-prompt builder (see promptBuilder.js). `playful` is the original “comedy show” mix, kept as one choice among several. */
export const STYLE_BUILDERS = {
    brief:   { tone: 'neutral', length: 'short',  focus: ['facts'], extra: '' },
    facts:   { tone: 'neutral', length: 'medium', focus: ['facts', 'numbers', 'opinions', 'quotes'], extra: '' },
    actions: { tone: 'neutral', length: 'medium', focus: ['facts', 'actions'], extra: '' },
    playful: { tone: 'casual',  length: 'long',   focus: ['title', 'quotes', 'standup', 'media', 'style'], extra: '' }
};
export const DEFAULT_STYLE = 'brief';

/** Style cards with their example output for one shared sample article (a city trial of car-free Sundays). */
export function styles() {
    return [
        { id: 'brief', title: T('Short & clear'), hint: T('The main point in plain language, a few lines.'),
          example: `<h4>${E('Car-free Sundays on trial')}</h4><p>${E('The city closes its centre to cars on twelve Sundays to find out whether air quality and shop sales improve.')}</p>` },
        { id: 'facts', title: T('Facts & quotes'), hint: T('Exact numbers, names and the key quotes.'),
          example: `<h4>${E('Car-free Sundays on trial')}</h4><ul><li>${E('12 Sundays, 6 km of streets closed')}</li><li>${E('Goal: 15 % less NO₂ in the centre')}</li><li>${E('Shop owners expect fewer customers; a survey follows in May.')}</li></ul><blockquote>${E('“We want to know whether people come back on foot.” — the mayor')}</blockquote>` },
        { id: 'actions', title: T('Takeaways'), hint: T('What it means for you and what to do next.'),
          example: `<p>${E('A three-month trial closes the city centre to cars on Sundays.')}</p><h4>${E('Takeaways')}</h4><ul><li>${E('Plan Sunday trips by bike or tram.')}</li><li>${E('Shops: check the survey in May and speak up before the vote.')}</li></ul>` },
        { id: 'playful', title: T('Playful'), hint: T('A creative title, a comedian’s take and media tips.'),
          example: `<h4>🚲 ${E('The Great Sunday Silence')}</h4><p>${E('Twelve Sundays, six kilometres, zero cars: the city wants to know whether anyone actually misses the traffic.')}</p><p>🎤 ${E('Comedian’s take: finally a day when the only thing honking is the goose on the bike lane.')}</p><p>📚 ${E('Read next: “Walkable City” by Jeff Speck')}</p>` }
    ];
}

/** “Make it yours” chips. Each one maps to a promptBuilder field, so Settings › Prompts shows the same choices. */
const lensLabel = (id) => ({ stoic: T('Stoic'), skeptic: T('Skeptic'), optimist: T('Optimist'), pragmatic: T('Pragmatic') })[id];
const INTERESTS = () => [['media', T('Book tips')], ['quotes', T('Key quotes')], ['actions', T('Action items')], ['numbers', T('Numbers')]];
const LENGTHS_UI = () => [['short', T('Short')], ['medium', T('Medium')], ['long', T('Detailed')]];
const TAG_SUGGESTIONS = () => [T('Designer'), T('Developer'), T('Student'), T('Founder'), T('Researcher')];

/** Template example + one line per chosen attribute the template does not already show. */
export function exampleFor(styleId, builder) {
    const base = (styles().find(x => x.id === styleId) || styles()[0]).example;
    const tpl = STYLE_BUILDERS[styleId] || {};
    const has = (id) => !(tpl.focus || []).includes(id) && (builder.focus || []).includes(id);
    const add = [];
    if (builder.lens === 'stoic') add.push(`🏛 ${E('The city can’t control shop sales, only how it plans Sundays. What matters, and what is noise?')}`);
    if (builder.lens === 'skeptic') add.push(`🔎 ${E('Twelve Sundays is a small sample, and no baseline for shop sales is named.')}`);
    if (builder.lens === 'optimist') add.push(`🌱 ${E('A cheap test that could make the centre calmer and greener.')}`);
    if (builder.lens === 'pragmatic') add.push(`🔧 ${E('Useful if the survey is honest; the NO₂ goal is the number to watch.')}`);
    if (has('media')) add.push(`📚 ${E('Read next: “Walkable City” by Jeff Speck')}`);
    if (has('quotes')) add.push(`❝ ${E('“We want to know whether people come back on foot.” — the mayor')}`);
    if (has('actions')) add.push(`✅ ${E('Plan Sunday trips by bike or tram.')}`);
    if (has('numbers')) add.push(`# ${E('12 Sundays, 6 km, goal: 15 % less NO₂')}`);
    if (builder.about && builder.about.length) add.push(`<em>${E('Tuned for: {tags}').replace('{tags}', builder.about.map(x => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join(', '))}</em>`);
    return base + add.map(a => `<p>${a}</p>`).join('');
}

/** Mounts the step into `host` (cleared first). `onDone(styleId)` runs after the choice has been stored. */
export function mountStyleStep(host, { onDone, onBack } = {}) {
    host.textContent = '';
    const list = styles();
    let chosen = DEFAULT_STYLE;
    let builder = normalizeBuilder(STYLE_BUILDERS[chosen]);

    host.append(mk('p', 'onboarding-intro', T('How should your summaries read? Start from a style, then make it yours — you can change everything any time under Settings → Prompt.')));
    const group = mk('div', 'onboarding-options onboarding-styles'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', T('Summary style'));
    const example = mk('div', 'onboarding-example'); example.setAttribute('aria-live', 'polite');
    const exLabel = mk('div', 'onboarding-example-label', T('Example'));
    const exBody = mk('div', 'onboarding-example-body');
    example.append(exLabel, exBody);

    const paint = () => {
        group.querySelectorAll('.onboarding-style').forEach((b) => {
            const on = b.dataset.style === chosen;
            b.classList.toggle('is-selected', on); b.setAttribute('aria-checked', String(on));
        });
        const s = list.find(x => x.id === chosen);
        exBody.innerHTML = s ? exampleFor(chosen, builder) : '';
        const keep = host.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.chip : null;
        paintChips();
        if (keep) { const again = [...you.querySelectorAll('[data-chip]')].find(x => x.dataset.chip === keep && !x.disabled); if (again) again.focus(); }
        promptText.textContent = buildArticlePrompt(builder);
    };
    list.forEach((s) => {
        const b = mk('button', 'onboarding-option onboarding-option--action onboarding-style'); b.type = 'button'; b.dataset.style = s.id;
        b.setAttribute('role', 'radio');
        b.append(mk('strong', '', s.title), mk('span', '', s.hint));
        b.addEventListener('click', () => { chosen = s.id; builder = normalizeBuilder({ ...STYLE_BUILDERS[chosen], about: builder.about }); paint(); });
        group.append(b);
    });

    // ── Make it yours: mindset (one), interests (several), length (one), own tags ──
    const you = mk('div', 'onboarding-you');
    const pill = (label, on, onClick, extra) => {
        const b = mk('button', 'pill' + (on ? ' on' : ''), label); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); if (extra) b.dataset.chip = extra;
        b.addEventListener('click', onClick); return b;
    };
    const section = (title) => { const g = mk('div', 'onboarding-you-group'); g.append(mk('span', 'onboarding-you-label', title)); const row = mk('div', 'ps-chips'); g.append(row); you.append(g); return row; };
    const mindRow = section(T('Mindset')), intRow = section(T('Interests')), lenRow = section(T('Length')), tagRow = section(T('About you'));
    const tagInput = mk('input', 'onboarding-tag-input'); tagInput.type = 'text'; tagInput.maxLength = MAX_TAG_LENGTH; tagInput.setAttribute('aria-label', T('Add your own tag'));
    tagInput.placeholder = T('Add your own, e.g. parent of two');
    const tagAdd = mk('button', 'button-secondary onboarding-tag-add', T('Add')); tagAdd.type = 'button';
    const tagForm = mk('div', 'onboarding-tag-form'); tagForm.append(tagInput, tagAdd);
    you.querySelectorAll('.onboarding-you-group')[3].append(tagForm);
    const setTags = (list) => { const tags = normalizeTags(list); const b = { ...builder }; if (tags.length) b.about = tags; else delete b.about; builder = normalizeBuilder(b); paint(); };
    const addTag = () => { const v = tagInput.value; tagInput.value = ''; if (v.trim()) setTags([...(builder.about || []), v]); tagInput.focus(); };
    tagAdd.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
    function paintChips() {
        mindRow.textContent = intRow.textContent = lenRow.textContent = tagRow.textContent = '';
        LENSES.forEach(l => mindRow.append(pill(lensLabel(l.id), builder.lens === l.id, () => {
            const b = { ...builder }; if (b.lens === l.id) delete b.lens; else b.lens = l.id; builder = normalizeBuilder(b); paint();
        }, 'lens-' + l.id)));
        INTERESTS().forEach(([id, label]) => intRow.append(pill(label, builder.focus.includes(id), () => {
            builder = normalizeBuilder({ ...builder, focus: builder.focus.includes(id) ? builder.focus.filter(x => x !== id) : [...builder.focus, id] }); paint();
        }, 'focus-' + id)));
        LENGTHS_UI().forEach(([id, label]) => lenRow.append(pill(label, builder.length === id, () => { builder = normalizeBuilder({ ...builder, length: id }); paint(); }, 'length-' + id)));
        const mine = builder.about || [];
        mine.forEach(t => { const b = pill(t + '  ✕', true, () => setTags(mine.filter(x => x !== t)), 'tag'); b.setAttribute('aria-label', T('Remove {tag}', { tag: t })); tagRow.append(b); });
        TAG_SUGGESTIONS().filter(t => !mine.some(x => x.toLocaleLowerCase() === t.toLocaleLowerCase())).forEach(t => {
            const b = pill('＋ ' + t, false, () => setTags([...mine, t]), 'suggest'); b.disabled = mine.length >= MAX_TAGS; tagRow.append(b);
        });
        tagInput.disabled = tagAdd.disabled = mine.length >= MAX_TAGS;
    }
    const promptBox = mk('details', 'onboarding-prompt');
    const promptText = mk('pre', 'onboarding-prompt-text');
    promptBox.append(mk('summary', '', T('Show the prompt')), promptText);
    host.append(group, you, example, promptBox);

    const actions = mk('div', 'onboarding-actions');
    if (onBack) { const back = mk('button', 'button-secondary', T('Back')); back.type = 'button'; back.addEventListener('click', onBack); actions.append(back); }
    const done = mk('button', 'button-primary onboarding-skip', T('Done')); done.type = 'button';
    done.addEventListener('click', async () => {
        done.disabled = true;
        const final = normalizeBuilder(builder);
        try {
            await chrome.storage.sync.set({ promptType: 'builder', presetPrompt: 'builder', promptBuilder: final, prompt: buildArticlePrompt(final) });
        } catch (_) { /* the default prompt stays */ }
        if (onDone) onDone(chosen);
    });
    actions.append(done);
    host.append(actions);
    paint();
}
