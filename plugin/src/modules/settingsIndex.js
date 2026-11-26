// settingsIndex.js — what Settings contains, as data: panels and the searchable controls (also the command palette's settings entries).
// Kept apart from settingsNav.js so pages that only list settings (home page, reading view) do not load the Settings screen code.
import { T, N_ } from './feedI18n.js';
import { storeBuild } from './storeBuild.js';

// Search index: one entry per control. `target` is the element id to scroll to
// and flash after jumping to its panel; `kw` are extra match words.
export const INDEX = [
    ['appearance', N_('Home page'), 'openHomeButton', 'start page new tab dashboard widgets overview'],
    ['account', N_('Account sync · sign in / log out'), 'otpEmail', 'login log in email magic code logout log out account'],
    ['account', N_('Pro license key'), 'licenseKey', 'activate plan upgrade pass pro subscription'],
    ['models', N_('Connection path'), 'modeCloud', 'cloud byphil own key bring your own'],
    ['models', N_('Preferred cloud model'), 'cloudModelSelect', 'gemini gpt claude model cloud'],
    ['models', N_('Provider'), 'model', 'openai mistral deepseek gemini ollama api'],
    ['models', N_('Model identifier'), 'modelIdentifier', 'model name id gpt llama'],
    ['models', N_('API key'), 'apiKey', 'key token secret'],
    ['models', N_('Endpoint URL'), 'customEndpoint', 'ollama local server custom'],
    ['prompts', N_('Preset prompt'), 'promptSettingsRoot', 'prompt preset template'],
    ['prompts', N_('Custom prompt text'), 'promptSettingsRoot', 'prompt instructions system custom guided builder tone length focus'],
    ['prompts', N_('Feed briefing & recap style'), 'promptSettingsRoot', 'feeds briefing recap style tone length'],
    ['feeds', N_('Sources · rename · tags · mute'), 'feedSubsCard', 'rss feeds subscriptions tags folder group rename mute unsubscribe sources'],
    ['feeds', N_('Import / export OPML'), 'feedOpmlActions', 'opml import export rss subscriptions backup reader'],
    ['feedprefs', N_('Mark read when opened'), 'feedSetMarkRead', 'feed read unread open'],
    ['feedprefs', N_('Mood on/off (tone analysis)'), 'feedSetMood', 'mood sentiment tone positive negative disable hide analysis diet'],
    ['feedprefs', N_('Process the whole Feed library (Ollama)'), 'feedPrefsLibrary', 'ollama batch whole library recap rate categorize local on-device automatic background'],
    ['library', N_('Process the whole Feed library (Ollama)'), 'libraryToolButton', 'ollama batch whole library recap rate categorize local on-device'],
    ['feedprefs', N_('Rate items with the recap'), 'feedSetRate', 'feed ai recap rate score sentiment mood category label automatic'],
    ['feedprefs', N_('Auto-summarize favorites'), 'feedSetAutoSum', 'feed favorite star summarize automatic background'],
    ['feedprefs', N_('Check feeds in the background'), 'feedSetPoll', 'feed badge notification new items poll background'],
    ['feedprefs', N_('Feed refresh interval'), 'feedSetRefresh', 'feed refresh update minutes hour interval'],
    ['feedprefs', N_('Keep feed items for'), 'feedSetKeep', 'feed retention days delete old cleanup'],
    ['reading', N_('Page highlighting'), 'highlightingToggle', 'highlight yellow marker annotate'],
    ['reading', N_('AI ghost highlighting'), 'aiHighlightingToggle', 'ghost highlight ai quotes blue'],
    ['reading', N_('Ghost highlight amount'), 'ghostHighlightAmount', 'ghost highlight few regular a lot'],
    ['reading', N_('Speed-Read'), 'speedReadSettings', 'speed read rsvp word by word fast later close tab reminder wpm schnell lesen'],
    ['send', N_('Delivery method'), 'deliveryPreference', 'kindle koreader localsend send deliver'],
    ['send', N_('Kindle devices'), 'newKindleEmail', 'kindle email device send to kindle'],
    ['send', N_('KOReader / LocalSend devices'), 'newLocalSendIp', 'koreader localsend ip device scan'],
    ['send', N_('Obsidian vault and folder'), 'obsidianVault', 'obsidian vault folder note markdown'],
    ['send', N_('Bookmarklet generator'), 'generateBookmarkletBtn', 'bookmarklet ios android mobile safari'],
    ['appearance', N_('Theme'), 'themeSeg', 'dark light mode appearance system contrast'],
    ['appearance', N_('UI language'), 'uiLangSelect', 'language translation locale interface'],
    ['accessibility', N_('Accessibility profile'), 'profileList', 'accessibility a11y profile large text high contrast calm barrierefreiheit'],
    ['accessibility', N_('Text size'), 'textScaleRange', 'text size font zoom larger bigger smaller'],
    ['accessibility', N_('Line spacing'), 'lineSeg', 'text size font dyslexia reading spacing'],
    ['accessibility', N_('Easy-read font'), 'readableFontToggle', 'dyslexia font atkinson readable low vision'],
    ['accessibility', N_('Reduce motion'), 'reduceMotionToggle', 'animation motion vestibular calm'],
    ['appearance', N_('Bottom dock'), 'dockEditor', 'dock tabs bottom navigation order hide reorder feeds notes history'],
    ['appearance', N_('Native Chrome side panel'), 'nativeSidePanelToggle', 'sidebar side panel popup window'],
    ['library', N_('Export settings'), 'exportSettingsButton', 'backup export download json'],
    ['library', N_('Import settings'), 'importSettingsButton', 'restore import backup json'],
    ['library', N_('Clean up & merge tags'), 'cleanupTagsButton', 'tags duplicates merge clean on-device'],
    ['library', N_('Storage & cleanup'), 'libStorage', 'storage space free memory size images pictures cleanup large old lag slow'],
    ['library', N_('Save images with articles'), 'saveImagesToggle', 'images pictures photos save storage text only'],
    ['library', N_('Delete history'), 'deleteHistoryButton', 'danger erase clear remove articles archive'],
    ['library', N_('Delete all data'), 'deleteAllButton', 'danger erase clear remove everything wipe reset factory keys feeds highlights'],
    ['library', N_('Delete settings'), 'deleteSettingsButton', 'danger reset erase remove'],
    ['about', N_('Feedback · contact · donate'), 'settingsPanel-about', 'bug support feedback contact donation help'],
    ['about', N_('Version & GitHub'), 'versionNumber', 'version contribute open source github'],
    ['about', N_('Privacy policy'), 'aboutPrivacyLink', 'privacy data gdpr policy security changelog'],
    ['sync', N_('Publish my library to my own server'), 'syncSettings', 'sync backup publish webdav nextcloud owncloud synology nas website server json library list s3 folder'],
    ['mcp', N_('Let AI apps on this computer use my library'), 'mcpSettings', 'mcp model context protocol claude desktop lm studio cursor vs code ollama local ai agent search library search_library'],
];

export const PANEL_TITLES = {
    account: N_('Account & Plan'), models: N_('Models & API'), prompts: N_('Prompts'), feeds: N_('Sources'), feedprefs: N_('Feed preferences'), reading: N_('Reading & Highlighting'),
    send: N_('Send & Share'), appearance: N_('Appearance & Language'), accessibility: N_('Accessibility'), library: N_('Library & Data'), sync: N_('Sync & backup'), mcp: N_('AI apps (MCP)'), about: N_('About & Tools')
};

/** For the command palette: every panel and every searchable control as { panel, title, target, kw }. */
export function settingsEntries() {
    return [
        ...Object.entries(PANEL_TITLES).map(([panel, title]) => ({ panel, title: T(title), target: undefined, kw: '' })),
        ...INDEX.filter(([, , target]) => !(storeBuild() && target === 'licenseKey')).map(([panel, title, target, kw]) => ({ panel, title: T(title), target, kw })),
    ];
}

