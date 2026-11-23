// settings/general.js — split out of settingsManager.js (R4 phase 1).
import { applyA11y, SCHEMES, DESIGNS, normalizeAppearance, clampScale, systemTheme, systemReducesMotion } from '../a11y.js';
import { paintSeg, bindSegKeys } from '../segmented.js';
import { supportsNativeSidePanel } from '../extensionApi.js';
import StorageManager from '../storageManager.js';
import { T } from '../feedI18n.js';
import { flashSaveIndicator, autoSave } from './autosave.js';

// ── Section: General Settings ────────────────────────────────────────
export function initGeneralSettings(storageData) {
    // ── Theme + display & reading preferences (profiles + customize) ──
    const A11Y_KEYS = ['theme', 'design', 'textScale', 'lineSpacing', 'readableFont', 'reduceMotion', 'iconStyle', 'colorScheme'];
    const look = normalizeAppearance(storageData);   // older settings (theme "contrast", scheme "postil" / "blue") are read onto the three axes
    const a11yState = { colorScheme: look.colorScheme, design: look.design, iconStyle: storageData.iconStyle === 'icons' ? 'icons' : 'emoji', theme: look.theme, textScale: clampScale(storageData.textScale || 100), lineSpacing: storageData.lineSpacing === 'compact' || storageData.lineSpacing === 'relaxed' ? storageData.lineSpacing : 'normal', readableFont: !!storageData.readableFont, reduceMotion: !!storageData.reduceMotion };
    // Settings from older versions (theme "contrast", scheme "postil" / "blue") are written once in the new shape, so changing one axis later cannot lose the others
    if (storageData.theme === 'contrast' || storageData.colorScheme === 'postil' || storageData.colorScheme === 'blue') StorageManager.set({ theme: look.theme, design: look.design, colorScheme: look.colorScheme }).catch(() => {});
    // Every profile states all the values it controls, so switching profiles never keeps a leftover
    // (e.g. High contrast theme or Reduce motion from the previous profile).
    const PROFILES = {
        default: () => ({ design: a11yState.design === 'contrast' ? 'standard' : a11yState.design, textScale: 100, lineSpacing: 'normal', readableFont: false, reduceMotion: false }),
        large: () => ({ design: a11yState.design === 'contrast' ? 'standard' : a11yState.design, textScale: 125, lineSpacing: 'relaxed', reduceMotion: false }),
        contrast: () => ({ design: 'contrast', textScale: 100, lineSpacing: 'normal', reduceMotion: false }),
        calm: () => ({ design: a11yState.design === 'contrast' ? 'standard' : a11yState.design, textScale: 100, lineSpacing: 'normal', reduceMotion: true })
    };
    const activeProfile = () => {
        const s = a11yState;
        if (s.design === 'contrast') return 'contrast';
        if (s.textScale >= 125 && s.lineSpacing === 'relaxed') return 'large';
        if (s.reduceMotion && s.textScale === 100 && s.lineSpacing === 'normal' && !s.readableFont) return 'calm';
        if (s.textScale === 100 && s.lineSpacing === 'normal' && !s.readableFont && !s.reduceMotion) return 'default';
        return '';
    };
    const $id = (id) => document.getElementById(id);
    const sysMotion = systemReducesMotion();
    const themeName = () => ({ light: T('Light Mode'), dark: T('Dark Mode') }[a11yState.theme] || (systemTheme() === 'dark' ? T('Dark Mode') : T('Light Mode')));
    const designName = () => ({ postil: 'Postil', contrast: T('High contrast') }[a11yState.design] || T('Standard'));
    const paintSegById = (id, v) => paintSeg($id(id), (b) => b.dataset.value === v);
    const syncUi = () => {
        paintSegById('themeSeg', a11yState.theme); paintSegById('designSeg', a11yState.design); paintSegById('schemeSeg', a11yState.colorScheme); paintSegById('lineSeg', a11yState.lineSpacing); paintSegById('iconSeg', a11yState.iconStyle);
        const th = $id('themeHint'); if (th) th.textContent = a11yState.theme === 'system' ? T('Currently following your system: {theme}').replace('{theme}', themeName()) : '';
        const sr = $id('textScaleRange'); if (sr) sr.value = String(a11yState.textScale);
        const sv = $id('textScaleValue'); if (sv) sv.textContent = a11yState.textScale + '%';
        if (sr) sr.style.setProperty('--range-progress', ((a11yState.textScale - 85) / (150 - 85) * 100) + '%');
        const ft = $id('readableFontToggle'); if (ft) ft.checked = a11yState.readableFont;
        const mt = $id('reduceMotionToggle'); if (mt) mt.checked = a11yState.reduceMotion || sysMotion;
        const mh = $id('motionHint'); if (mh) mh.textContent = sysMotion ? T('Your system already asks for reduced motion — it is always respected.') : T('Currently following your system: off');
        const cur = activeProfile();
        document.querySelectorAll('#profileList [role=radio]').forEach(b => { const on = b.dataset.profile === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        const st = $id('a11yStatus');
        if (st) {
            const sum = [themeName(), designName(), (a11yState.reduceMotion || sysMotion) ? T('Motion reduced') : T('Motion on'), a11yState.textScale + '%'].join(' · ');
            st.textContent = '✓ ' + (cur === 'default' && a11yState.theme === 'system' ? T('Following your system: {summary}') : T('Your settings: {summary}')).replace('{summary}', sum);
        }
        applyA11y({ ...a11yState });
    };
    const setA11y = (patch, persist = true) => {
        const changed = A11Y_KEYS.filter(k => k in patch && patch[k] !== a11yState[k]);
        Object.assign(a11yState, patch);
        syncUi();
        if (persist) changed.forEach(k => autoSave(k, a11yState[k]));
    };
    // Segmented controls (radiogroups) with arrow-key support
    const seg = (id, onPick) => {
        const el = $id(id); if (!el) return;
        el.querySelectorAll('[role=radio]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.value)));
        bindSegKeys(el);   // arrow keys, Home, End (modules/segmented.js)
    };
    // the words of the three switches (written in popup.html in English)
    { const words = { themeLabel: T('Brightness'), designLabel: T('Look'), schemeLabel: T('Color scheme') }; Object.entries(words).forEach(([id, t]) => { const e = $id(id); if (e) e.textContent = t; });
      const lab = { themeSeg: { system: T('Auto'), light: T('Light'), dark: T('Dark') }, designSeg: { standard: T('Standard'), contrast: T('High contrast') } };
      Object.entries(lab).forEach(([id, m]) => document.querySelectorAll('#' + id + ' [data-value]').forEach((b) => { if (m[b.dataset.value]) b.textContent = m[b.dataset.value]; })); }
    // the colour dots have no words: the name is the accessible name and the tooltip
    { const names = { default: T('Default'), kaivo: 'Kaivo', aish: 'Aish', viola: 'Viola', graphite: T('Graphite') };
      document.querySelectorAll('#schemeSeg [data-value]').forEach((b) => { const n = names[b.dataset.value]; if (n) { b.setAttribute('aria-label', n); b.title = n; } }); }
    seg('themeSeg', (v) => setA11y({ theme: v === 'light' || v === 'dark' ? v : 'system' }));
    seg('designSeg', (v) => setA11y({ design: DESIGNS.includes(v) ? v : 'standard' }));
    seg('schemeSeg', (v) => setA11y({ colorScheme: SCHEMES.includes(v) ? v : 'default' }));
    seg('lineSeg', (v) => setA11y({ lineSpacing: v }));
    seg('iconSeg', (v) => setA11y({ iconStyle: v === 'icons' ? 'icons' : 'emoji' }));
    document.querySelectorAll('#profileList [role=radio]').forEach(b => b.addEventListener('click', () => setA11y((PROFILES[b.dataset.profile] || (() => ({})))())));
    const scaleRange = $id('textScaleRange');
    if (scaleRange) {
        scaleRange.addEventListener('input', () => setA11y({ textScale: clampScale(scaleRange.value) }, false));
        scaleRange.addEventListener('change', () => autoSave('textScale', a11yState.textScale));
    }
    const fontToggle = $id('readableFontToggle');
    if (fontToggle) fontToggle.addEventListener('change', () => setA11y({ readableFont: fontToggle.checked }));
    const motionToggle = $id('reduceMotionToggle');
    if (motionToggle) motionToggle.addEventListener('change', () => setA11y({ reduceMotion: motionToggle.checked }));
    syncUi();
    // Customize opens by itself when the current values are not one of the profiles
    const customEl = $id('a11yCustom');
    if (customEl && !activeProfile()) customEl.open = true;

    // ── UI Language ────────────────────────────────────────────────
    const uiLangSelect = document.getElementById('uiLangSelect');
    if (uiLangSelect) {
        const savedUiLang = ({ pt: 'pt_PT' })[storageData.uiLanguage] || storageData.uiLanguage || '';
        if (savedUiLang && ![...uiLangSelect.options].some(o => o.value === savedUiLang)) {
            // Language no longer offered (not actively maintained): keep it
            // visible for people who already picked it, so the control isn't blank.
            const legacy = document.createElement('option');
            legacy.value = savedUiLang;
            legacy.textContent = ({ ar: 'العربية', it: 'Italiano', ru: 'Русский', bn: 'বাংলা' }[savedUiLang] || savedUiLang) + ' (' + T('no longer updated') + ')';
            uiLangSelect.appendChild(legacy);
        }
        uiLangSelect.value = savedUiLang;
        uiLangSelect.addEventListener('change', async () => {
            const val = uiLangSelect.value;
            await autoSave('uiLanguage', val);
            try {
                const { applyTranslations } = await import('../i18n.js');
                applyTranslations(val);
            } catch (e) {
                console.error('Translation failed', e);
            }
        });
    }

    // ── Native Side Panel ──────────────────────────────────────────
    const nativeToggle = document.getElementById('nativeSidePanelToggle');
    if (nativeToggle) {
        nativeToggle.checked = !!storageData.useNativeSidePanel;
        if (!supportsNativeSidePanel()) { const blk = nativeToggle.closest('.a11y-block'); if (blk) blk.hidden = true; }   // Chrome-only option; Firefox has its own sidebar (View > Sidebar)
        nativeToggle.addEventListener('change', () => {
            autoSave('useNativeSidePanel', nativeToggle.checked);
        });
    }

    // ── Notify when the background queue finishes ──────────────────
    for (const [id, key] of [['obsidianVault', 'obsidianVault'], ['obsidianFolder', 'obsidianFolder']]) {
        const input = document.getElementById(id);
        if (!input) continue;
        input.value = storageData[key] || '';
        input.addEventListener('change', async () => { await autoSave(key, input.value.trim()); document.dispatchEvent(new CustomEvent('aish:delivery-default')); });
    }
    const notifyToggle = document.getElementById('notifyWhenDoneToggle');
    if (notifyToggle) {
        notifyToggle.checked = storageData.notifyWhenDone !== false;
        notifyToggle.addEventListener('change', () => autoSave('notifyWhenDone', notifyToggle.checked));
    }

    // ── Highlighting Toggles (separate features) ───────────────────
    const highlightToggle = document.getElementById('highlightingToggle');
    const aiHighlightToggle = document.getElementById('aiHighlightingToggle');
    const legacyHighlighting = storageData.highlightingEnabled !== false;

    const getUserHighlightValue = () => {
        if (highlightToggle) return !!highlightToggle.checked;
        return storageData.userHighlightingEnabled !== undefined
            ? storageData.userHighlightingEnabled !== false
            : legacyHighlighting;
    };

    const getAiHighlightValue = () => {
        if (aiHighlightToggle) return !!aiHighlightToggle.checked;
        return storageData.aiHighlightingEnabled !== undefined
            ? storageData.aiHighlightingEnabled !== false
            : legacyHighlighting;
    };

    const persistHighlightingSettings = async (key, value) => {
        const payload = {
            [key]: value,
            // Backward compatibility key for older builds.
            highlightingEnabled: getUserHighlightValue() && getAiHighlightValue()
        };
        await StorageManager.set(payload);
        flashSaveIndicator();
    };

    if (highlightToggle) {
        highlightToggle.checked = storageData.userHighlightingEnabled !== undefined
            ? storageData.userHighlightingEnabled !== false
            : legacyHighlighting;
        highlightToggle.addEventListener('change', () => {
            persistHighlightingSettings('userHighlightingEnabled', highlightToggle.checked);
        });
    }

    if (aiHighlightToggle) {
        aiHighlightToggle.checked = storageData.aiHighlightingEnabled !== undefined
            ? storageData.aiHighlightingEnabled !== false
            : legacyHighlighting;
        aiHighlightToggle.addEventListener('change', () => {
            persistHighlightingSettings('aiHighlightingEnabled', aiHighlightToggle.checked);
        });
    }

    // ── AI Ghost Highlight Amount ────────────────────────────────
    const ghostHighlightAmount = document.getElementById('ghostHighlightAmount');
    if (ghostHighlightAmount) {
        ghostHighlightAmount.value = storageData.ghostHighlightAmount || 'regular';
        ghostHighlightAmount.addEventListener('change', () => {
            autoSave('ghostHighlightAmount', ghostHighlightAmount.value);
        });
    }

    // ── Sites where the on-page highlights panel stays hidden ─────
    const excludedSites = document.getElementById('highlightExcludedSites');
    if (excludedSites) {
        const list = Array.isArray(storageData.highlightExcludedSites) ? storageData.highlightExcludedSites : [];
        excludedSites.value = list.join('\n');
        excludedSites.addEventListener('change', () => {
            const hosts = excludedSites.value.split(/[\s,]+/)
                .map(h => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
                .filter(Boolean);
            autoSave('highlightExcludedSites', [...new Set(hosts)]);
        });
    }
}

