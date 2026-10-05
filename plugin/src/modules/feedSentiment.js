// feedSentiment.js
// Tiny on-device mood scorer for feed headlines + snippets. No network, no
// model: a small word list with negation handling. Good enough to sort/filter
// "calm vs heavy" news; it is a heuristic, not a verdict.

const POS = new Set(('win wins won winning success successful great good better best improve improves improved improvement ' +
    'breakthrough launch launches launched released release new fast faster safe safer secure free love loved lovely ' +
    'happy joy delight delightful beautiful brilliant clever elegant simple easy useful helpful hope hopeful growth grow grows ' +
    'record gain gains rise rises recovery recover recovers cure cures solved solves solution fix fixes fixed wins ' +
    'celebrate celebrates celebrated praise praised award awarded honor thrilled excited exciting amazing awesome wonderful ' +
    'positive progress achieve achieves achieved discovery discover discovers friendly kind generous inspiring stronger ' +
    'cheaper efficient reliable stable healthy peace welcome welcomes approve approved boost boosts surge thrive thrives').split(/\s+/));

const NEG = new Set(('war wars attack attacks attacked kill kills killed killing death deaths dead die dies died crash crashes crashed ' +
    'crisis fail fails failed failure fraud scam hack hacked hacker breach breaches leak leaks leaked ban bans banned ' +
    'bad worse worst decline declines fall falls fell drop drops dropped loss losses lose loses lost cut cuts layoffs layoff ' +
    'fire fired threat threats threaten threatens risk risks risky danger dangerous warn warns warning scare scary fear fears ' +
    'collapse collapses disaster disasters tragedy tragic victim victims shooting shot explosion bomb terror terrorist ' +
    'lawsuit sue sues sued fine fined arrest arrested prison jail outage outages bug bugs broken vulnerable vulnerability ' +
    'angry anger outrage outrageous hate hated toxic abuse abused scandal controversy controversial disappointing disappoints ' +
    'recession inflation shortage shortages strike strikes protest protests violence violent crime crimes stolen theft ' +
    'sad sadly worry worried worries pain painful sick illness disease pandemic cancer shutdown shut shuts bankrupt bankruptcy').split(/\s+/));

const NEGATORS = new Set(['not', 'no', 'never', 'without', "isn't", "wasn't", "don't", "doesn't", "didn't", "can't", "won't", 'cannot', 'neither']);

/** @returns {number} score in [-1, 1]; 0 = neutral/unknown */
export function scoreSentiment(text) {
    if (!text) return 0;
    const words = String(text).toLowerCase().replace(/[“”"()[\]{}.,;:!?—–-]/g, ' ').split(/\s+/).filter(Boolean);
    let p = 0, n = 0, flip = 0;
    for (const w of words) {
        if (NEGATORS.has(w)) { flip = 2; continue; }
        let s = POS.has(w) ? 1 : NEG.has(w) ? -1 : 0;
        if (s && flip > 0) s = -s;
        if (s > 0) p++; else if (s < 0) n++;
        if (flip > 0) flip--;
    }
    if (!p && !n) return 0;
    return Math.max(-1, Math.min(1, (p - n) / (p + n + 2)));
}

/** @returns {'pos'|'neg'|'neu'} */
export function moodOf(score) {
    return score >= 0.15 ? 'pos' : score <= -0.15 ? 'neg' : 'neu';
}

export const MOOD_EMOJI = { pos: '😊', neu: '', neg: '😟' };
