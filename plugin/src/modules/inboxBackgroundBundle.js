// Entry of the background bundle (inbox-worker.js, global AISH_INBOX): the phone-inbox collector for the classic-script background.
import { createInboxManager, applyLinkMeta } from './inboxManager.js';

export const API = { createInboxManager, applyLinkMeta };
