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

/**
 * The route the last request took, as a sentence (the server's answer, not our wish). `used` is the model that really answered; when the server
 * swapped it (a long text on the everyday EU model goes to the larger one) that is said, so the cost and the model are never a surprise.
 */
export function routeSentence(route) {
    if (!route || !route.region) return '';
    const on = route.region === 'eu' ? 'ran on EU servers' : 'did not run on EU servers';
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
