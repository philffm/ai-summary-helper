// modules/aboutView.js — Settings → "About & Tools" (design: Figma "About & Tools · 3 variants", B maker note + C diagnostics).
//   1. Maker note: who builds AISH, one donate button, feedback and contact beside it
//   2. What's new in this version (update WHATS_NEW with each release; product words, not commit messages)
//   3. Diagnostics: copies version, browser, system and a few counts for bug reports (no keys, no URLs, no article titles)
//   4. Footer: GitHub · changelog · privacy · security, version
import { T } from './feedI18n.js';
import { SK } from './storageKeys.js';
import { iconEl } from './icons.js';

const LINKS = {
    donate: 'https://link.philwornath.com/?source=aish#donate',
    feedback: 'https://app.formbricks.com/s/cm3kn4nmg00032dmy85vlbjzp',
    contact: 'https://philwornath.com/?ref=aish#contact',
    github: 'https://github.com/philffm/ai-summary-helper',
    changelog: 'https://github.com/philffm/ai-summary-helper/blob/main/CHANGELOG.md',
    privacy: 'https://ai-summary-helper.byphil.eu/privacy.html',
    security: 'https://github.com/philffm/ai-summary-helper/blob/main/SECURITY.md',
};
// Highlights of the current release. Keep it to three short lines a reader cares about.
const WHATS_NEW = () => ([
    ['bot', T('AI apps (MCP): Claude Desktop, LM Studio or Cursor can search your library')],
    ['sparkles', T('Summarize starts right away, even when the extension was asleep')],
    ['archive', T('Articles saved from archive.ph or the Wayback Machine keep the original link')],
]);

const version = () => { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function linkButton(href, label, cls, icon) {
    const a = el('a', cls); a.href = href; a.target = '_blank'; a.rel = 'noopener';
    if (icon) a.append(iconEl(icon));
    a.append(el('span', null, label));
    return a;
}
function link(href, label, id) { const a = el('a', 'about-link', label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; if (id) a.id = id; return a; }

function browserInfo() {
    const ua = navigator.userAgent || '';
    const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    const brand = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) || brands.find((b) => /chromium/i.test(b.brand));
    const browser = brand ? `${brand.brand} ${brand.version}` : ((ua.match(/(Firefox|Edg|Chrome|Safari)\/(\d+)/) || []).slice(1).join(' ') || 'unknown');
    const os = (navigator.userAgentData && navigator.userAgentData.platform) || (/Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : 'unknown');
    return { browser, os };
}
// Plain facts only: no API keys, no tokens, no URLs, no titles.
async function debugInfo() {
    const { browser, os } = browserInfo();
    const local = await new Promise((r) => chrome.storage.local.get({ [SK.articlesIndex]: [], [SK.feedSubs]: [] }, r));
    const sync = await new Promise((r) => chrome.storage.sync.get({ connectionMode: '' }, r));
    const surface = document.body && document.body.dataset.surface || 'popup';
    return [
        `AI Summary Helper ${version()}`,
        `Browser: ${browser}`,
        `System: ${os}`,
        `Opened as: ${surface}`,
        `UI language: ${document.documentElement.lang || navigator.language || ''}`,
        `Connection: ${sync.connectionMode || 'default'}`,
        `Articles: ${(local[SK.articlesIndex] || []).length} · Feeds: ${(local[SK.feedSubs] || []).length}`,
        `Window: ${window.innerWidth}×${window.innerHeight}`,
    ].join('\n');
}

export function initAboutView() {
    const root = document.getElementById('aboutView');
    if (!root) return;
    root.replaceChildren();

    // 1. maker note
    const note = el('div', 'about-card');
    note.append(el('h3', 'about-title', T('Hi, I\'m Phil 👋')));
    note.append(el('p', 'about-text', T('I build AI Summary Helper on my own. It\'s open source, shows no ads and keeps your library on your device.')));
    note.append(linkButton(LINKS.donate, T('Support with a donation'), 'button-primary about-donate', 'heart'));
    const acts = el('div', 'about-actions');
    acts.append(linkButton(LINKS.feedback, T('Give feedback'), 'button-secondary btn-sm', 'message-square'),
        linkButton(LINKS.contact, T('Contact me'), 'button-secondary btn-sm'));
    note.append(acts);

    // 2. what's new
    const head = el('div', 'about-section-head');
    head.append(el('p', 'settings-caption', T('What\'s new in {v}', { v: version() }).toUpperCase()), link(LINKS.changelog, T('Full changelog ›')));
    const news = el('ul', 'about-card about-news');
    for (const [icon, line] of WHATS_NEW()) { const li = el('li'); li.append(iconEl(icon), el('span', null, line)); news.append(li); }

    // 3. diagnostics
    const diagHead = el('p', 'settings-caption', T('Tools').toUpperCase());
    const diag = el('div', 'about-card');
    diag.append(el('h3', 'about-title', T('Diagnostics')));
    const { browser, os } = browserInfo();
    diag.append(el('p', 'about-text about-muted', `AI Summary Helper ${version()} · ${browser} · ${os}. ` + T('Paste this into a bug report so it can be reproduced.')));
    const copy = el('button', 'button-secondary btn-sm about-copy'); copy.type = 'button';
    const copyLabel = el('span', null, T('Copy debug info')); copy.append(iconEl('copy'), copyLabel);
    copy.addEventListener('click', async () => {
        const text = await debugInfo();
        try { await navigator.clipboard.writeText(text); copyLabel.textContent = T('Copied'); }
        catch (_) { copyLabel.textContent = T('Copy failed'); }
        setTimeout(() => { copyLabel.textContent = T('Copy debug info'); }, 2000);
    });
    const diagActs = el('div', 'about-actions'); diagActs.append(copy);
    diag.append(diagActs);

    // 4. footer
    const foot = el('p', 'about-footer');
    foot.append(link(LINKS.github, T('Contribute on GitHub')), ' · ', link(LINKS.privacy, T('Privacy policy'), 'aboutPrivacyLink'), ' · ', link(LINKS.security, T('Security policy')));
    const ver = el('p', 'about-footer about-muted');
    const v = el('span', null, version()); v.id = 'versionNumber';
    ver.append(document.createTextNode('AI Summary Helper v'), v, document.createTextNode(' · ' + T('Open source by Phil Wornath')));

    root.append(note, head, news, diagHead, diag, foot, ver);
}
