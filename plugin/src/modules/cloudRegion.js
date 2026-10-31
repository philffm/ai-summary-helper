// modules/cloudRegion.js
// "Prefer EU servers" for the hosted (byphil Cloud) models. The server decides the route; the app only says what it prefers, shows which models
// can run on EU servers (and what that costs there), and shows which route a request actually took. Every model stays usable either way.
//   storage (sync): cloudRegionPref = 'any' | 'prefer-eu'          storage (local): SK.cloudRoute = { region: 'eu' | 'global', model, at }
export const PREF_ANY = 'any', PREF_EU = 'prefer-eu';
export const isEuPreferred = (pref) => pref === PREF_EU;

/** The roster says whether it knows about regions at all (older servers do not): only then is the setting offered. */
export const supportsEu = (roster) => !!(roster && Array.isArray(roster.regions) && roster.regions.includes('eu'));

/**
 * What to show next to a model: null when nothing is known. With the preference on, a model that cannot run in the EU is called out
 * ('outside') because that is the thing to notice; with it off the EU models are only marked.
 * @returns {null | { kind: 'eu' | 'outside', text: string }}
 */
export function regionTag(model, pref) {
    if (!model || typeof model.eu !== 'boolean') return null;
    if (model.eu_company) return { kind: 'company', text: 'EU company' };   // a European company's model, which also runs on EU servers
    if (model.auto && !isEuPreferred(pref)) return null;                    // Auto may pick any model on the normal route: no claim about it
    if (model.eu) return { kind: 'eu', text: 'EU' };
    return isEuPreferred(pref) ? { kind: 'outside', text: 'Not EU' } : null;
}

/** The prices to show: on EU servers the same model can cost more, so with the preference on an EU model shows its EU price. */
export function pricesFor(model, pref) {
    if (!model) return { price_in: NaN, price_out: NaN };
    if (isEuPreferred(pref) && model.eu === true && Number.isFinite(model.eu_price_in) && Number.isFinite(model.eu_price_out)) return { price_in: model.eu_price_in, price_out: model.eu_price_out };
    return { price_in: model.price_in, price_out: model.price_out };
}

const prettyModel = (id) => String(id || '').split('/').pop().replace(/-(\d{4})$/, '').replace(/-(\d+)-(\d+)(?=-|$)/g, ' $1.$2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());   // mistral-large-4-0 → Mistral Large 4.0

export const FALLBACK_CLOUD_MODEL = 'google/gemini-3.8-flash';

/**
 * The model a NEW account starts with: Auto when the hosted service offers it, else the plain default. Nothing is assumed: a service that has not
 * been updated (no Auto in its list, or unreachable) keeps the old default, so a first request never names a model that does not exist.
 * Accounts that already chose a model are never touched (the caller only asks when none is set).
 */
export async function newAccountModel(apiBase, fetchFn = (...a) => globalThis.fetch(...a)) {
    try {
        const res = await fetchFn(`${apiBase}/v1/projects/ai_summary_helper/models`, { signal: AbortSignal.timeout(4000) });
        const roster = await res.json();
        const auto = roster && roster.success && Array.isArray(roster.models) ? roster.models.find((m) => m && m.auto && m.id === 'auto') : null;
        return auto ? 'auto' : FALLBACK_CLOUD_MODEL;
    } catch (_) { return FALLBACK_CLOUD_MODEL; }
}

/**
 * The route the last request took, as a sentence (the server's answer, not our wish). `used` is the model that really answered; when the server
 * swapped it (a long text on the everyday EU model goes to the larger one) that is said, so the cost and the model are never a surprise.
 */
const AUTO_WHY = { standard: 'an everyday text', 'short-text': 'a short text', 'long-text': 'a long text', 'short-task': 'a short task', analysis: 'an analysis', allowance: 'the monthly allowance is nearly used up', 'only-model': 'the only model of that family on EU servers' };
export function routeSentence(route) {
    if (!route || !route.region) return '';
    const on = route.region === 'eu' ? 'ran on EU servers' : 'did not run on EU servers';
    if (route.auto && route.used) return `Auto chose ${prettyModel(route.used)} (${AUTO_WHY[route.auto.reason] || route.auto.reason}). The last request ${on}.`;
    if (route.switched === 'long-text' && route.used) return `The last request ${on}, on ${prettyModel(route.used)}: the text was long, so the larger model was used.`;
    return `The last request ${on}.`;
}

/**
 * With "Prefer EU servers" on and the chosen model not available in the EU, the app offers the EU default instead (one tap, never automatic).
 * @returns {null | { id: string, name: string }}
 */
export function euSuggestion(roster, currentId, pref) {
    if (!isEuPreferred(pref) || !supportsEu(roster) || !roster.eu_default) return null;
    const cur = (roster.models || []).find((m) => m.id === currentId);
    if (cur && cur.eu === true) return null;   // already on an EU model
    const target = (roster.models || []).find((m) => m.id === roster.eu_default);
    return { id: roster.eu_default, name: target ? target.name : prettyModel(roster.eu_default) };
}
