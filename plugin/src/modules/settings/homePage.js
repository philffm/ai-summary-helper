// settings/homePage.js — Settings › Home page: open it, copy its address, and how each browser makes it the start page.
// The browser's own settings are the way: the extension does not take over new tabs.
import { T } from '../feedI18n.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** Which guide fits this browser: 'ios' | 'firefox' | 'edge' | 'safari' | 'chrome' (Chrome, Brave and other Chromium). */
export function browserFamily(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Edg\//.test(ua)) return 'edge';
    if (/Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua)) return 'safari';
    return 'chrome';
}

/** The guides in reading order; `address` says whether pasting the page's address is part of them. */
export function guides() {
    return [
        { id: 'chrome', name: T('Chrome and Brave'), address: true, steps: [
            T('Settings › On startup › Open a specific page or set of pages › Add a new page, then paste the address.'),
            T('Home button: Settings › Appearance › Show home button, then paste the address.')] },
        { id: 'edge', name: 'Microsoft Edge', address: true, steps: [
            T('Settings › Start, home, and new tab page › When Edge starts › Open these pages › Add a new page, then paste the address.')] },
        { id: 'firefox', name: 'Firefox', address: true, steps: [
            T('Paste it in Firefox Settings › Home › Homepage and new windows › Custom URLs.')] },
        { id: 'safari', name: T('Safari on Mac'), address: false, steps: [
            T('Home cannot be set as the start page in Safari yet. Open it with the button above.')] },
        { id: 'ios', name: T('iPhone and iPad'), address: false, steps: [
            T('Home cannot be set as the start page in Safari on iPhone and iPad. Open it with the button above, or use the Today tab of the AISH app.')] },
    ];
}

export function initHomeSettings(doc = document, { family = browserFamily() } = {}) {
    const box = doc.getElementById('homeGuide');
    if (!box || box.childElementCount) return;
    const all = guides();
    const mine = all.find((g) => g.id === family) || all[0];
    const copy = doc.getElementById('copyHomeAddressButton');
    if (copy) copy.hidden = !mine.address;
    // this browser first and open, the others folded underneath
    for (const g of [mine, ...all.filter((x) => x !== mine)]) {
        const section = el('details', 'a11y-custom');
        section.dataset.browser = g.id;
        section.open = g === mine;
        section.append(el('summary', '', g === mine ? T('{browser} (this browser)', { browser: g.name }) : g.name));
        const steps = el('div', 'a11y-block');
        steps.append(...g.steps.map((s) => el('p', 'a11y-hint', s)));
        section.append(steps);
        box.append(section);
    }
}

/** The two buttons, bound once when the settings are set up. */
export function bindHomeButtons(doc = document) {
    const open = doc.getElementById('openHomeButton');
    if (open) open.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('home.html') }));
    const copy = doc.getElementById('copyHomeAddressButton');
    if (!copy) return;
    copy.addEventListener('click', async () => {
        const address = chrome.runtime.getURL('home.html');
        const label = copy.textContent;
        try { await navigator.clipboard.writeText(address); copy.textContent = T('Copied'); }
        catch (_) {   // clipboard refused: show the address so it can be selected
            const input = Object.assign(doc.createElement('input'), { value: address, readOnly: true }); input.setAttribute('aria-label', T('Home page address'));
            copy.replaceWith(input); input.select(); return;
        }
        setTimeout(() => { copy.textContent = label; }, 1800);
    });
}
