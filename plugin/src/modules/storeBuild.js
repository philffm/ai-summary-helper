// storeBuild.js — Apple's App Store allows no purchase or unlocking beside its own: the iOS build shows no prices, checkout
// links, donation buttons or key fields. Signing in and a pass bought elsewhere keep working. scripts/build.js sets the
// marked value to true for the iOS build, and stops if it finds none.
export const STORE_BUILD = /*@store-build*/ false;
export const storeBuild = () => STORE_BUILD || globalThis.__aishStoreBuild === true;
