// dateUtils.js — shared date helpers.

/** Local midnight (ms) of the day containing `ts`. */
export function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
