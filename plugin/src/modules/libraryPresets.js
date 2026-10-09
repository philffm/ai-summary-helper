// libraryPresets.js — performance profiles for processing the Feed library with a local model, and the benchmark maths.
//
// A profile is just a named set of the knobs that already exist: items per request, AI requests per run, run interval.
// The benchmark times a fixed rating batch on THIS machine and turns it into numbers per profile ("a run takes about
// 40 s, 120 items per hour"). The reference classes are rough, hand-written orders of magnitude for typical setups so
// the user can place their own result; nothing is collected from other users and nothing leaves the machine.

export const PRESETS = {
    eco:      { batch: 10, requests: 1, minutes: 60 },
    balanced: { batch: 20, requests: 3, minutes: 30 },
    power:    { batch: 40, requests: 6, minutes: 15 }
};
export const PRESET_IDS = ['eco', 'balanced', 'power'];
export const REQUEST_STEPS = [1, 2, 3, 4, 6, 8];
export const DEFAULT_REQUESTS = 3;
export const cleanRequests = (n) => REQUEST_STEPS.includes(Number(n)) ? Number(n) : DEFAULT_REQUESTS;

/** Which profile do these settings match? 'custom' when they were changed by hand. */
export function presetOf(s = {}) {
    const batch = Number(s.libraryBatch) || 20, requests = cleanRequests(s.requestsPerTick), minutes = Number(s.autoProcessMinutes) || 30;
    return PRESET_IDS.find((id) => PRESETS[id].batch === batch && PRESETS[id].requests === requests && PRESETS[id].minutes === minutes) || 'custom';
}

/** Settings keys a profile sets. */
export const presetSettings = (id) => PRESETS[id] ? { libraryBatch: PRESETS[id].batch, requestsPerTick: PRESETS[id].requests, autoProcessMinutes: PRESETS[id].minutes } : null;

// The fixed benchmark batch: 20 invented, neutral headlines (same work as rating a real batch of 20).
export const BENCH_COUNT = 20;
export const BENCH_TITLES = [
    'City council approves new bike lanes along the river', 'Researchers report progress on a low-cost battery design',
    'Local bakery wins national award for sourdough', 'Central bank leaves interest rates unchanged',
    'Storm warning issued for the northern coast', 'Football club signs young striker on a three-year deal',
    'New museum exhibit explores medieval trade routes', 'Software update fixes security flaw in popular browser',
    'Hospital opens extra ward to reduce waiting times', 'Farmers worry about dry spring after weeks without rain',
    'Film festival announces its opening-night line-up', 'Train service resumes after signal failure',
    'University launches free online course on climate science', 'Housing prices rise slightly for the third month',
    'Volunteers clean up the beach ahead of the summer season', 'Startup raises funding for recycling technology',
    'Parliament debates changes to the school curriculum', 'Marathon route changed because of road works',
    'Astronomers photograph a distant galaxy cluster', 'Airline adds new direct flights to the south'
];
export const benchItems = () => BENCH_TITLES.map((title, k) => ({ id: 'bench' + k, feedId: 'bench', title, snippet: '' }));

/**
 * Rough reference classes for ONE 20-headline rating batch (score + category) with a local model, warm.
 * Orders of magnitude, not a ranking of products: they exist so a number like "34 s" means something.
 */
export const REFERENCE = [
    { id: 'power',    maxSec: 10,       label: 'GPU or Apple Silicon, 7–8B model' },
    { id: 'balanced', maxSec: 45,       label: 'Recent laptop, small (3–4B) model' },
    { id: 'eco',      maxSec: 150,      label: 'CPU only or older machine' },
    { id: 'slow',     maxSec: Infinity, label: 'Very slow: use a smaller model' }
];
export const classOf = (secPerBatch) => (REFERENCE.find((r) => secPerBatch <= r.maxSec) || REFERENCE[REFERENCE.length - 1]).id;

/** Per profile, derived from the measured seconds per 20 items (time scales about linearly with the batch size). */
export function projection(secPer20, id) {
    const p = PRESETS[id];
    const tickSec = p.requests * secPer20 * (p.batch / BENCH_COUNT);
    return { tickSec, itemsPerHour: Math.floor(p.requests * p.batch * (60 / p.minutes)), busyShare: Math.min(1, tickSec / (p.minutes * 60)) };
}

/** Strongest profile whose run stays under `maxTickSec` (default 2 min); 'eco' when none does. */
export function recommend(secPer20, maxTickSec = 120) {
    for (const id of ['power', 'balanced', 'eco']) if (projection(secPer20, id).tickSec <= maxTickSec) return id;
    return 'eco';
}
