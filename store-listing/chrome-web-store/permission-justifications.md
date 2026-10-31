# Permission justifications (Developer Dashboard → Privacy practices)

Paste each text into the matching field. Checked against `plugin/platforms/chrome/manifest.json` and the code (Oct 2026, 2.2.36). When a permission is added or its use changes, update the text here and in the dashboard.

## Single purpose

> AI Summary Helper summarizes the web page, PDF or video the user is reading with the AI model of their choice, and keeps the results in a private, searchable reading library on their device.

## Permissions

**offscreen**
> The built-in podcast player for the RSS reader needs to keep playing audio after the popup or side panel closes. Manifest V3 service workers cannot play audio, so the extension creates an offscreen document with the AUDIO_PLAYBACK reason, only when the user presses play on a podcast episode. It contains no page content and no data collection, and it just hosts an audio element for the episode the user chose.

**sidePanel**
> The side panel is the main interface of the extension. It shows the summary of the current page next to the page itself, and the user's History, Feeds, knowledge graph and analytics. The user can keep reading and asking follow-up questions while the panel stays open. The extension opens it only on the user's click on the toolbar icon or on the keyboard shortcut.

**tts**
> The "Listen" and "Instant Read" features read a summary or article aloud with the browser's own text-to-speech voices. The extension uses chrome.tts so that reading continues when the popup closes and the user can pause or change speed. It only speaks text the user asked to have read. Nothing is recorded or sent anywhere.

**activeTab**
> When the user starts a summary (toolbar button, keyboard shortcut or right-click menu), the extension reads the text of the current tab to summarize it. activeTab gives that access for the tab the user is acting on.

**tabs**
> The extension needs the URL and title of tabs to save and de-duplicate articles in the library, to match a saved article to the page that is open, and to close the tab when the user chooses "Summarize & close tab". It does not collect browsing history.

**scripting**
> Injects the content scripts that extract the article text, and that draw the AI ghost highlights and the user's own highlights on the page, on pages the user summarizes or has highlighted.

**storage / unlimitedStorage**
> The library (articles, summaries, highlights, notes, feeds, settings) is stored locally in the browser, on the user's device. A long reading history can exceed the default storage quota, so unlimitedStorage prevents data loss. Nothing is stored on a server unless the user turns on an optional sync or send feature.

**contextMenus**
> Adds the right-click entries "Summarize this page", "Summarize & close tab", "Highlight selection" and "Remove all highlights".

**notifications**
> Shows the reminder the user set on a saved article ("Tomorrow", "Weekend" and so on), so they can come back to it at the chosen time. It also confirms completed sends. Only notifications the user asked for are shown.

**alarms**
> Wakes the service worker at the times the user set: reminders for saved articles, the optional background refresh of subscribed RSS feeds (every 15 minutes to 6 hours) and the phone-inbox check. No alarms run for tracking or advertising.

## Host permissions

**`<all_urls>`**
> The user can summarize any web page, so the extension must read the text of whichever page they choose and show highlights on it again when they come back. It also fetches the RSS and Atom feeds the user subscribed to, from many different sites, and talks to the sync, backup or publishing server (Nextcloud or another WebDAV server, or S3-compatible) that the user enters in Settings, whose address can be anywhere. Library sync is off until the user adds such a place; everything is encrypted in the browser before upload unless the user chooses to publish readable files. Page content is sent only to the AI provider the user configured (or nowhere with a local model). The extension never reads or modifies pages in the background for any other purpose.

**`file:///*`**
> Lets the user summarize PDF and HTML files stored on their computer, which Chrome only allows when the user turns on "Allow access to file URLs" for the extension.

## Folder on this computer

No manifest permission. When the user picks a folder as a sync or backup place, Chrome's own folder picker and permission prompt apply (File System Access API); the extension keeps only Chrome's handle to that one folder and can reach nothing else on the disk.

## Remote code

> No. The extension does not load or run remotely hosted code; all scripts are in the package. Its source is public on GitHub (philffm/ai-summary-helper).

## Data usage disclosures (checklist)

Answer to match the privacy policy at https://ai-summary-helper.byphil.eu/privacy.html:

- Collected: website content (text of pages the user summarizes, sent to the AI provider they chose, or to byphil Cloud if they use it) and, only with the optional byphil sign-in, the user's email address.
- Not collected: health, financial, location, personal communications, authentication information beyond the optional sign-in.
- Certify: no selling of user data, no use for purposes unrelated to the single purpose, no use for creditworthiness or lending.
