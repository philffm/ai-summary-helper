// feedSentiment.js
import { moodEnabled } from './moodSetting.js';
// Mood helpers for feed items. Scores (-1..1) come only from AI ("Score with
// AI" in Feeds); there is no on-device scoring. Unscored items have no mood.

/** @returns {'pos'|'neg'|'neu'} */
export function moodOf(score) {
    return score >= 0.15 ? 'pos' : score <= -0.15 ? 'neg' : 'neu';
}

/** Mood of a feed item, or null when it has not been AI-scored. */
export function itemMood(item) {
    return moodEnabled() && item && item.ai && typeof item.sent === 'number' ? moodOf(item.sent) : null;
}

export const MOOD_EMOJI = { pos: '😊', neu: '', neg: '😟' };
