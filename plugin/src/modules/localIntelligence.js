// localIntelligence.js
// Single entry point for content.js to dynamically import() the whole
// on-device intelligence layer in one call:
//
//   const LI = await import(chrome.runtime.getURL('modules/localIntelligence.js'));
//   const dup = LI.findDuplicate(candidate, existingArticles, index);
//
// popup-side code (articleManager.js, mainScreen.js, etc.) can instead
// import the individual modules directly with static imports — this file
// exists purely to make content.js's single dynamic import ergonomic.

export * from './textUtils.js';
export * from './localSearch.js';
export * from './duplicateDetector.js';
export * from './textMetrics.js';
export * from './tagIntelligence.js';
