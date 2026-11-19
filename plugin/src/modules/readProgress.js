// modules/readProgress.js — how far an article was read, measured from the scroll depth of a reading view.
//
// Only the DEEPEST point counts (it never goes down). A jump to the end is not reading: the last tenth only counts once the page
// was open and in front long enough for the text (a quarter of the time it takes to read it, at least 10 s). Until then the depth
// is held just below "finished". Pure: the page feeds samples in, `save(progress)` stores the result (StorageManager.patchArticleProgress).
import { FINISHED_AT } from './storageManager.js';

const WORDS_PER_MIN = 230, MIN_ACTIVE_MS = 10000, ACTIVE_SHARE = 0.25, MAX_GAP_MS = 5000, SAVE_STEP = 0.02;
const JUST_BELOW = Math.round((FINISHED_AT - 0.01) * 100) / 100;

/** How long the page has to have been in front before the end counts, in ms. */
export const minActiveMs = (words) => Math.max(MIN_ACTIVE_MS, Math.round((Math.max(0, words) / WORDS_PER_MIN) * 60000 * ACTIVE_SHARE));

/**
 * @param {{ words?: number, start?: number, save: (progress: number) => any, now?: () => number }} o
 *   start = the progress already stored (the tracker only reports more than that)
 */
export function createReadTracker({ words = 0, start = 0, save, now = Date.now }) {
    const need = minActiveMs(words);
    let deepest = Number(start) || 0, saved = deepest, active = 0, last = null;
    const credit = (depth) => (depth >= FINISHED_AT && active < need ? Math.min(depth, JUST_BELOW) : depth);
    return {
        /** A look at the page: `depth` 0…1 = how far down the bottom edge of the view is, `visible` = the page is in front. */
        sample(depth, visible = true) {
            const t = now();
            if (last !== null && visible) active += Math.min(MAX_GAP_MS, Math.max(0, t - last));
            last = visible ? t : null;
            const d = Math.round(credit(Math.min(1, Math.max(0, Number(depth) || 0))) * 100) / 100;
            if (d > deepest) deepest = d;
            if (deepest - saved >= SAVE_STEP || (deepest >= FINISHED_AT && saved < FINISHED_AT)) { saved = deepest; return Promise.resolve(save(deepest)); }
            return null;
        },
        /** Writes what is left (the page is closing). */
        flush() { if (deepest > saved) { saved = deepest; return Promise.resolve(save(deepest)); } return null; },
        get deepest() { return deepest; },
        get activeMs() { return active; },
    };
}
