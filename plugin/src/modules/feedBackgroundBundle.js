import { feedItemId, parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan } from './feedWorker.js';
import { hash } from './feedHash.js';
import { saveFeedBodies, pruneFeedBodies } from './feedBodies.js';
import { scoreItems, generateFeedTopics, translateFeedTopics, learnTagNames, uiLanguage, generateRecap, generateRecapUpdate, itemSig, getRecapLimit, setRecapLimit, setAiDetail, setAiTransport } from './feedAi.js';
import { planLibrary, runLibrary, categoryCounts, chunksOf } from './libraryBatch.js';
import { startOfDay } from './dateUtils.js';
import { loadLexicon, saveLexicon } from './topicLexicon.js';

export const API = {
    feedItemId, parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan, hash, saveFeedBodies, pruneFeedBodies,
    scoreItems, generateFeedTopics, translateFeedTopics, learnTagNames, uiLanguage, generateRecap, generateRecapUpdate, itemSig, getRecapLimit, setRecapLimit, setAiDetail, setAiTransport,
    planLibrary, runLibrary, categoryCounts, chunksOf, startOfDay, loadLexicon, saveLexicon
};
