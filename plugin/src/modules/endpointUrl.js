// endpointUrl.js — OpenAI-compatible server addresses. Users may type the base (https://host/v1), the base with a trailing
// slash, or the full …/chat/completions URL; the full chat URL is what gets stored, the base is used for GET /models.

const CHAT_TAIL = /\/chat\/completions\/?$/i;

/**
 * @param {string} input
 * @returns {{ok:true, chatUrl:string, baseUrl:string} | {ok:false}}
 */
export function normalizeChatUrl(input) {
    const raw = String(input || '').trim();
    if (!raw) return { ok: false };
    let u;
    try { u = new URL(raw); } catch (_) { return { ok: false }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    u.search = ''; u.hash = '';
    let path = u.pathname.replace(CHAT_TAIL, '').replace(/\/+$/, '');
    const baseUrl = u.origin + path;
    return { ok: true, chatUrl: baseUrl + '/chat/completions', baseUrl };
}

/** Where the model list lives for a stored (or typed) endpoint. '' when the address is unusable. */
export function modelsUrl(input) {
    const n = normalizeChatUrl(input);
    return n.ok ? n.baseUrl + '/models' : '';
}
