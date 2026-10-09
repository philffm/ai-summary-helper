// topicLexicon.js — keeps the learned topic lexicon (see topicConcepts.js) in chrome.storage.local.
// One small object for the whole extension: { englishKey: { locale: label, '*': [other spellings] } }.
// Nothing is attached to articles or feed items, so exports keep the original tags.

import { SK } from './storageKeys.js';
import { setLexicon, getLexicon } from './topicConcepts.js';

let loading = null;

/** Load the lexicon once (shared promise) and keep it in sync when another page — e.g. the background worker — learns something. */
export function loadLexicon() {
    if (!loading) {
        loading = (async () => {
            try { setLexicon((await chrome.storage.local.get(SK.topicLexicon))[SK.topicLexicon]); } catch (e) { /* no storage (tests): start empty */ }
            try {
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area === 'local' && changes[SK.topicLexicon]) setLexicon(changes[SK.topicLexicon].newValue);
                });
            } catch (e) { /* no change events here */ }
        })();
    }
    return loading;
}

/** Write the lexicon back (call after anything that learned a tag). */
export async function saveLexicon() {
    try { await chrome.storage.local.set({ [SK.topicLexicon]: getLexicon() }); } catch (e) { /* the lexicon is a convenience */ }
}
