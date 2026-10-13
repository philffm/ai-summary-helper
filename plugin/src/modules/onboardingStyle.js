// onboardingStyle.js — second onboarding step: pick how summaries read, with a live example of each style.
// The examples are written out (no model call: the step must work before anything is configured, and instantly).
// Choosing writes the same keys the Prompt settings use (promptType 'builder'), so the style stays editable there.
import { T as tr } from './feedI18n.js';
import { buildArticlePrompt } from './promptBuilder.js';

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

/** Mounts the step into `host` (cleared first). `onDone(styleId)` runs after the choice has been stored. */
export function mountStyleStep(host, { onDone, onBack } = {}) {
    host.textContent = '';
    const list = styles();
    let chosen = DEFAULT_STYLE;

    host.append(mk('p', 'onboarding-intro', T('How should your summaries read? Pick a style — you can change it any time under Settings → Prompt.')));
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
        exBody.innerHTML = s ? s.example : '';
    };
    list.forEach((s) => {
        const b = mk('button', 'onboarding-option onboarding-option--action onboarding-style'); b.type = 'button'; b.dataset.style = s.id;
        b.setAttribute('role', 'radio');
        b.append(mk('strong', '', s.title), mk('span', '', s.hint));
        b.addEventListener('click', () => { chosen = s.id; paint(); });
        group.append(b);
    });
    host.append(group, example);

    const actions = mk('div', 'onboarding-actions');
    if (onBack) { const back = mk('button', 'button-secondary', T('Back')); back.type = 'button'; back.addEventListener('click', onBack); actions.append(back); }
    const done = mk('button', 'button-primary onboarding-skip', T('Done')); done.type = 'button';
    done.addEventListener('click', async () => {
        done.disabled = true;
        const builder = STYLE_BUILDERS[chosen] || STYLE_BUILDERS[DEFAULT_STYLE];
        try {
            await chrome.storage.sync.set({ promptType: 'builder', presetPrompt: 'builder', promptBuilder: builder, prompt: buildArticlePrompt(builder) });
        } catch (_) { /* the default prompt stays */ }
        if (onDone) onDone(chosen);
    });
    actions.append(done);
    host.append(actions);
    paint();
}
