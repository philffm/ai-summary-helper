// Entry of the background bundle (targets-worker.js, global AISH_TARGETS): the outbox for send targets in the classic-script background.
import { createTargets } from './targets/service.js';
import { registerAdapter, getAdapter, listAdapters } from './targets/adapters.js';
import { TargetError } from './targets/targetError.js';
import { createSafeFetch } from './targets/safeFetch.js';

export const API = { createTargets, registerAdapter, getAdapter, listAdapters, TargetError, createSafeFetch };
