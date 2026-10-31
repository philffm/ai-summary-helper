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

/** The route the last request took, as a sentence (the server's answer, not our wish). */
export function routeSentence(route) {
    if (!route || !route.region) return '';
    return route.region === 'eu' ? 'The last request ran on EU servers.' : 'The last request did not run on EU servers.';
}
