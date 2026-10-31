// Entry of the background bundle (sync-worker.js, global AISH_SYNC): sync stamps, places and the publish engine for the classic-script background.
import { createStampStore } from './syncStampStore.js';
import { createSyncService } from './syncService.js';
import { makeStore } from './syncStores.js';
import { renderViewer, loadViewerTemplates } from './syncViewer.js';

export const API = { createStampStore, createSyncService, makeStore, renderViewer, loadViewerTemplates };
