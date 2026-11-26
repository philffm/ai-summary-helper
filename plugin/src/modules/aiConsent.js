// aiConsent.js — before text goes to an AI service on the internet, the App Store build says who receives it and asks
// (App Review 5.1.2(i)). A model on the device or in the local network needs no yes. The background refuses every request
// without it (bg/aiComplete.js aiRequireConsent): this module asks, and lists and withdraws what was allowed.
import { SK } from './storageKeys.js';
import { T } from './feedI18n.js';
import { storeBuild } from './storeBuild.js';
import { confirmSheet } from './confirmSheet.js';
import StorageManager from './storageManager.js';

// the same rule as AI_PRIVATE_HOST in bg/aiComplete.js (test295 compares them)
const PRIVATE_HOST = /^(localhost|.+\.localhost|.+\.local|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[::1\]|\[f[cd][0-9a-f]{2}:.*\]|\[fe80:.*\])$/i;

/** The host of an address that is out on the internet; '' for this device, the local network or no address. */
export function outsideHost(address) {
    try { const { hostname } = new URL(String(address || '')); return hostname && !PRIVATE_HOST.test(hostname) ? hostname : ''; }
    catch (_) { return ''; }
}

// the file as the background reads it: services are found by their `id` there (StorageManager.getServices() renames it)
const services = async () => { try { return await (await fetch(chrome.runtime.getURL('services.json'))).json(); } catch (_) { return []; } };

/** The address a request would go to now (the same choice as aiComplete() in bg/aiComplete.js). */
export async function aiAddress({ service = '', target = null } = {}) {
    if (target && target.endpoint) return String(target.endpoint);
    const sync = await chrome.storage.sync.get(['activeService', 'connectionMode']);
    if (!service && (sync.connectionMode || 'cloud') === 'cloud') return `${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/chat`;
    const id = service || sync.activeService || 'openai';
    if (id === 'gemini') return 'https://generativelanguage.googleapis.com/';
    const config = ((await chrome.storage.local.get(SK.servicesConfig))[SK.servicesConfig] || {})[id] || {};
    return config.endpointUrl || config.endpoint || (await services()).find((s) => String(s.id).toLowerCase() === id.toLowerCase())?.endpointUrl || '';
}

/** Who receives the text, in words a person can judge. */
async function recipient(host) {
    if (host === outsideHost(StorageManager.getApiBase())) return T('byPhil Cloud, which passes it on to OpenRouter and the company behind the chosen model');
    const known = (await services()).find((s) => outsideHost(s.endpointUrl) === host);
    return known ? `${known.name} (${host})` : host;
}

const granted = async () => (await chrome.storage.local.get(SK.aiConsent))[SK.aiConsent] || {};
const asking = new Map();   // host → the open question, so that parallel requests share one sheet

/** True when text may be sent to `url` (or to where the settings send it now): already allowed, no one outside, or a yes now. */
export async function ensureAiConsent({ url = '', service = '', target = null } = {}, { confirm = confirmSheet } = {}) {
    if (!storeBuild()) return true;
    const host = outsideHost(url || await aiAddress({ service, target }));
    if (!host || (await granted())[host]) return true;
    if (!asking.has(host)) {
        asking.set(host, (async () => {
            const yes = await confirm({
                title: T('Send text to an AI service?'), confirmLabel: T('Allow'), cancelLabel: T('Not now'), danger: false,
                text: T('To summarize, tag and answer, AISH sends the text of the pages, saved articles and feeds you use this with, and your questions, to {who}. Nothing is sent before you allow it. You can withdraw this under Settings › Models & API.', { who: await recipient(host) }),
            });
            if (yes) await chrome.storage.local.set({ [SK.aiConsent]: { ...(await granted()), [host]: new Date().toISOString() } });
            return yes;
        })().finally(() => asking.delete(host)));
    }
    return asking.get(host);
}

export const notAllowed = () => Object.assign(new Error(T('Nothing was sent. Allow it under Settings › Models & API first.')), { code: 'ai-consent' });

export async function withdrawAiConsent(host) {
    const rest = await granted();
    delete rest[host];
    await chrome.storage.local.set({ [SK.aiConsent]: rest });
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
let painting = 0;

/** Settings › Models & API: what may be sent where, with a way back. */
export async function renderAiConsent(doc = document) {
    const box = doc.getElementById('aiConsentGroup');
    if (!box) return;
    const turn = ++painting;
    if (!storeBuild()) { box.hidden = true; return; }
    const allowed = await granted();
    const current = outsideHost(await aiAddress());
    const hosts = [...new Set([...(current ? [current] : []), ...Object.keys(allowed)])];
    const rows = await Promise.all(hosts.map(async (host) => {
        const row = el('div', 'send-default-row');
        const button = el('button', 'button-secondary btn-sm', allowed[host] ? T('Withdraw') : T('Allow'));
        button.type = 'button';
        button.addEventListener('click', async () => {
            if (allowed[host]) await withdrawAiConsent(host); else await ensureAiConsent({ url: `https://${host}/` });
            await renderAiConsent(doc);
        });
        const who = await recipient(host);
        row.append(el('span', '', allowed[host] ? T('Allowed: {who}', { who }) : T('Not allowed yet: {who}', { who })), button);
        return row;
    }));
    if (turn !== painting) return;   // a newer paint is on its way
    box.replaceChildren(el('div', 'type-badge', T('Sending text to AI services')), ...rows);
    box.hidden = !rows.length;
}

export function initAiConsent(doc = document) {
    if (!storeBuild()) return;
    chrome.storage.onChanged?.addListener((changes) => {
        if ([SK.aiConsent, SK.servicesConfig, 'activeService', 'connectionMode'].some((k) => k in changes)) renderAiConsent(doc);
    });
    renderAiConsent(doc);
}
