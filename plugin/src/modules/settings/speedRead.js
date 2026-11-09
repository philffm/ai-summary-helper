// settings/speedRead.js — Settings › Reading › Speed-Read (Figma AISH-036.4). Saved at once in chrome.storage.sync
// `speedRead` (shape: modules/speedReadSettings.js); the reader on the page, the popup menu and the right-click menu read it.
import { T } from '../feedI18n.js';
import { SPEED_READ_KEY, speedReadNormalize } from '../speedReadSettings.js';
import { RSVP_MIN_WPM, RSVP_MAX_WPM, RSVP_STEP_WPM } from '../rsvp.js';
import { flashSaveIndicator } from './autosave.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function toggleRow(id, label, desc, checked) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const txt = el('div', 'setting-text');
    const l = el('label', 'setting-label', label); l.htmlFor = id;
    txt.append(l, el('p', 'setting-desc', desc));
    const sw = el('label', 'switch setting-switch');
    const input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
    sw.append(input, el('span', 'slider-toggle'));
    row.append(txt, sw);
    return { row, input };
}

function selectRow(id, label, options, value) {
    const row = el('div', 'setting-group flex justify-between align-center mb-3');
    const l = el('label', null, label); l.htmlFor = id;
    const sel = el('select'); sel.id = id;
    for (const [v, text] of options) { const o = el('option', null, text); o.value = String(v); if (String(v) === String(value)) o.selected = true; sel.append(o); }
    row.append(l, sel);
    return { row, sel };
}

/** Draws the Speed-Read group into #speedReadSettings (Reading panel) and saves every change. */
export async function initSpeedReadSettings(root = document.getElementById('speedReadSettings')) {
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    let s = speedReadNormalize((await chrome.storage.sync.get(SPEED_READ_KEY))[SPEED_READ_KEY]);
    const save = async (patch) => {
        s = speedReadNormalize({ ...s, ...patch });
        await chrome.storage.sync.set({ [SPEED_READ_KEY]: s });
        flashSaveIndicator();
        paint();
    };

    root.replaceChildren();
    const head = el('div', 'settings-card-head');
    head.append(el('h3', null, '⚡ ' + T('Speed-Read')), el('p', null, T('Speed-Read writes the summary, then shows it word by word with the sentence above. Pause any time to see the paragraph. It helps you get through a summary in about a minute; for careful reading, show it as text.')));
    root.append(head);

    const enabled = toggleRow('speedReadEnabled', T('Show Speed-Read in the menus'), T('In the popup next to “Summarize” and when you right-click a page'), s.enabled);
    enabled.input.addEventListener('change', () => save({ enabled: enabled.input.checked }));
    const speeds = [];
    for (let w = RSVP_MIN_WPM; w <= RSVP_MAX_WPM; w += RSVP_STEP_WPM * 2) speeds.push([w, T('{n} WPM', { n: w }) + (w === 300 ? ' · ' + T('recommended') : '')]);
    const wpm = selectRow('speedReadWpm', T('Speed'), speeds, s.wpm);
    wpm.sel.addEventListener('change', () => save({ wpm: Number(wpm.sel.value) }));
    const chunk = selectRow('speedReadChunk', T('Words at a time'), [[1, '1'], [2, '2'], [3, '3']], s.chunk);
    chunk.sel.addEventListener('change', () => save({ chunk: Number(chunk.sel.value) }));
    const full = toggleRow('speedReadFull', T('Full screen'), T('Hide the page while you read (F switches in the reader)'), s.fullscreen);
    full.input.addEventListener('change', () => save({ fullscreen: full.input.checked }));
    const close = toggleRow('speedReadCloseTab', T('Offer to close the tab at the end'), T('A 5-second countdown, only when you have read to the end. Any key or mouse movement stops it; a notification lets you reopen the tab.'), s.closeTab);
    close.input.addEventListener('change', () => save({ closeTab: close.input.checked }));
    const rem = selectRow('speedReadReminder', T('Remind me later'), [['none', T('No reminder')], ['tomorrow', T('Tomorrow morning')], ['weekend', T('At the weekend')], ['week', T('Next week')]], s.reminder);
    rem.sel.addEventListener('change', () => save({ reminder: rem.sel.value }));
    const timeRow = el('div', 'setting-group flex justify-between align-center mb-3');
    const tl = el('label', null, T('Reminder time')); tl.htmlFor = 'speedReadReminderTime';
    const time = el('input'); time.type = 'time'; time.id = 'speedReadReminderTime'; time.value = s.reminderTime;
    time.addEventListener('change', () => { if (time.value) save({ reminderTime: time.value }); });
    timeRow.append(tl, time);
    root.append(enabled.row, wpm.row, chunk.row, full.row, close.row, rem.row, timeRow);
    root.append(el('p', 'hint hint-sub', T('Keys in the reader: Space pause · ←/→ sentence · Shift+←/→ word · ↑/↓ speed · T text · F full screen · Esc stop')));

    function paint() {
        const on = s.enabled;
        for (const r of [wpm.row, chunk.row, full.row, close.row, rem.row, timeRow]) r.classList.toggle('is-disabled', !on);
        timeRow.hidden = s.reminder === 'none';
    }
    paint();
}
