// lengthControl.js — the "Summary Length" panel: Auto | Custom, a slider and a number field for exact values.
import { SK } from './storageKeys.js';
import { T } from './feedI18n.js';
import { el } from './dom.js';
import { BIASES, DEFAULT_WORDS, MAX_WORDS, MIN_WORDS, SLIDER_MAX, SLIDER_MIN, clampLength, readLengthSetting } from './summaryLength.js';

const biasLabel = () => ({ short: T('Shorter'), standard: T('Standard'), long: T('Longer') });

export async function initLengthControl() {
    const slider = document.getElementById('summaryLength');
    const number = document.getElementById('summaryLengthInput');
    const chip = document.getElementById('chipLengthLabel');
    const modeGrid = document.getElementById('lengthModeGrid');
    const biasGrid = document.getElementById('lengthBiasGrid');
    const autoBox = document.getElementById('lengthAutoBox');
    const customBox = document.getElementById('lengthCustomBox');
    const hint = document.getElementById('lengthAutoHint');
    if (!slider || !number || !modeGrid || !biasGrid) return;

    let state = readLengthSetting(await chrome.storage.local.get([SK.summaryLength, SK.summaryLengthMode, SK.summaryLengthBias]), SK);

    slider.min = SLIDER_MIN; slider.max = SLIDER_MAX; slider.step = 10;
    number.min = MIN_WORDS; number.max = MAX_WORDS; number.step = 1;
    number.setAttribute('aria-label', T('Summary length in words'));
    const unit = document.getElementById('lengthUnit'); if (unit) unit.textContent = T('words');
    hint.textContent = T('Short pages get a few sentences, long reads get more. Never longer than half the article.');

    const save = (patch) => {
        state = { ...state, ...patch };
        const out = { [SK.summaryLengthMode]: state.mode, [SK.summaryLengthBias]: state.bias };
        if (patch.value != null) out[SK.summaryLength] = state.value;
        return chrome.storage.local.set(out);
    };

    const paintSlider = () => {
        const v = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, state.value));
        slider.value = v;
        slider.style.setProperty('--range-progress', ((v - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100 + '%');
    };

    const group = (grid, items, current, onPick, label) => {
        grid.replaceChildren();
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', label);
        items.forEach(({ id, text }) => {
            const b = el('button', 'pill pill--sm pill--soft' + (id === current ? ' active' : ''), text);
            b.type = 'button';
            b.setAttribute('aria-pressed', id === current ? 'true' : 'false');
            b.addEventListener('click', (e) => { e.preventDefault(); if (id !== current) onPick(id); });
            grid.appendChild(b);
        });
    };

    const render = () => {
        const auto = state.mode === 'auto';
        group(modeGrid, [{ id: 'auto', text: T('Auto') }, { id: 'custom', text: T('Custom') }], state.mode, (m) => { save({ mode: m }); render(); }, T('Length mode'));
        group(biasGrid, BIASES.map((id) => ({ id, text: biasLabel()[id] })), state.bias, (b) => { save({ bias: b }); render(); }, T('Auto length bias'));
        autoBox.style.display = auto ? '' : 'none';
        customBox.style.display = auto ? 'none' : '';
        number.value = state.value;
        paintSlider();
        if (chip) chip.textContent = auto ? T('Auto') : state.value + 'w';
    };

    slider.addEventListener('input', () => {
        state.value = clampLength(slider.value);
        number.value = state.value;
        paintSlider();
        if (chip) chip.textContent = state.value + 'w';
        save({ value: state.value });
    });

    // Typing is free; the value is clamped and stored once it is a valid number (Enter / leaving the field fixes the rest).
    number.addEventListener('input', () => {
        const raw = Number(number.value);
        if (!Number.isFinite(raw) || raw < MIN_WORDS || raw > MAX_WORDS) return;
        state.value = Math.round(raw);
        paintSlider();
        if (chip) chip.textContent = state.value + 'w';
        save({ value: state.value });
    });
    const settle = () => {
        state.value = clampLength(number.value === '' ? DEFAULT_WORDS : number.value);
        number.value = state.value;
        paintSlider();
        if (chip) chip.textContent = state.value + 'w';
        save({ value: state.value });
    };
    number.addEventListener('change', settle);
    number.addEventListener('blur', settle);
    number.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); settle(); number.blur(); } });

    render();
}
