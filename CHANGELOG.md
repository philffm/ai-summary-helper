# Changelog

Notable changes, newest first. Versions follow `current_version.json`; releases are cut by `.github/workflows/release.yml`.
Commit history has the details: <https://github.com/philffm/ai-summary-helper/commits/main>.

## Unreleased

## 2.2.8 (2026-10-12)

### Commit log

#### Added

- Add gradle files

#### Changed

- Alarm sound: system alarm-sound picker plus a separate music file option
- Alarm: choose a wake-up sound, fade in over 45s, then read the briefing over ducked music
- UI up
- Web view: summarize button shows progress and turns into a green check that opens the reading list; Share on the thumb side; clearer progress text
- Email-code sign-in like the extension (Account & Plan panel); sync stays end-to-end encrypted via pairing
- Bottom bars use round icon buttons with the primary action at the thumb edge; favorite moves to the item header
- Left-handed mode: bottom bars align to the thumb side, web view puts Summarize next to the thumb; Accessibility settings (hand, reading text size)
- Filter chips back at the top; Settings as a home list with panels and search, like the extension
- Thumb-zone actions and swipe gestures: bottom bars in feeds, reading list, reader and web view; swipe to mark read/unread and favorite
- feat(android): Group similar is a Feeds setting in Settings; Settings restyled like the extension (captions, outlined cards, label + hint rows, button groups, emoji labels); read-aloud switch
- feat(android): UI polish: Feeds overflow menu (briefing, mood), Reading list swipe to delete with undo and reader text size, Settings grouped under section titles
- feat(android): on-device summary streams into the panel and is read aloud sentence by sentence while it is written (speaker toggle in the web view)
- feat(android): Share → AISH opens a sheet with Summarize on this phone (opens the page and summarizes it) and Send to browser
- feat(android): ghost highlights come out of the same model request as the summary (marker line, sentences validated against the page); no extra pass
- feat(android): group similar items in Feeds (same rules as the extension's stacks), summary language setting, AI ghost highlights for summaries made on the phone (switch in Settings)
- feat(android): select one or many feed items (long-press) to favorite, mark read/unread, share links or send to the browser
- feat(android): podcast player for feed episodes (audio enclosures): mini player above the navigation bar, media notification service, saved spot per episode, speed and seek
- feat(android): refreshable day recap card at the top of Feeds, written by the on-device model
- feat(android): favorites (star + filter), search across all feeds, feed management sheet with extension sync status; podcast enclosures and conditional GET in storage; gentler refresh; Add feed FAB removed
- Summarize screen: list real summaries only, saved-only pages stay in History
- Feed AI: rate in two small requests, titles only by default, AI settings as button groups
  - scoreItems: sentiment as '1:3 | 2:-2' pairs first, then one category request that picks from the categories in use + defaults and may add up to 2 new ones; a failed category request keeps the scores; retry is reported
  - benchmark shows ratings vs categories time (and a retry), still classifies by total
  - aiDetail default: titles only (80/20)
  - feedPrefsAi: choices use the shared segmented button group, no emoji in labels
  - tests 151/152, adjusted 4/106/114/150
- feat(android): feed storage for favorites, podcast enclosures and conditional refresh (ETag / Last-Modified, failed feeds are retried less often)
- feat(extension): feed AI setting 'What the AI reads' (titles only / titles + descriptions); repeat the task after the items so small local models do not just describe the list; recap Refresh/Reset/Copy buttons match the design and have icons
- feat(android): deleting from the reading list can be undone from a snackbar
- feat(android): Add feed offers the extension's starter feeds from shared/suggested-feeds.json (refreshed from GitHub), and a Today's briefing button in Feeds that writes it with the local model
- feat(android): alarm news mode as a three-way toggle (all news, no bad news, good only)
- feat(android): summaries from the web view go to the reading list (marked as made on this phone), can be shared (WhatsApp etc.), and the article can still be sent to the extension
- feat(android): summarize the open web page with the on-device model (DOM text extraction, chunked), keep sending the link to the extension from the web view
- feat(android): rate the whole stored feed history by mood in the background (resumable, stoppable)
- feat(android): rate feed items by mood with the on-device model (as in the extension's Feeds view), mood tint and Positive-only / Hide-heavy filters, good-news briefing goes by the ratings
- feat(android): read the license key from the pairing code, show the plan and monthly allowance, sign out on unpair
- feat(phone): the pairing code can carry the Pro license key (lk) for the phone's cloud extra; inbox and vault stay anonymous
- feat(android): good-news-only briefing and an optional cloud extra (fun fact or custom prompt) through the AISH chat endpoint
- chore(android): app named AISH (launcher) / AI Summary Helper (in app)
- feat(android): show the last crash on the next start (copyable) with a way to turn the alarm off
- build(android): kotlinOptions to compilerOptions DSL; LiteRT-LM needs Kotlin 2.4
- feat(android): on-device model (Gemma 4 E2B via LiteRT-LM): resumable Wi-Fi download with SHA-256 check, model-written spoken briefing, settings card
- feat(android): morning alarm with spoken feed briefing (no AI), prepared 20 minutes before; fix setPairing JVM clash
- feat(android): Material 3 app with Feeds, Reading and Settings tabs, adaptive two-pane layout for foldables, in-app web view, highlights
- feat(android): feed reader core (RSS/Atom/JSON Feed parser, feed store, vault sync, highlights); Gradle 8.13 for AGP 8.13
- feat(phone): send highlights and AI ghost highlights with the article; Send to phone sits with LocalSend
- feat(sync): encrypted feed-URL sync through a vault (merge rules, sealed document, Settings → Phone)
- feat(android): receive articles from the browser and read them offline
  - the pairing code may carry the extension→phone inbox (&ti=&tr=); old codes still work
  - Receiver + ReceiveWorker (every 15 min, plus Check now): read, decrypt (gzip + AES-GCM, v2), save, then delete on the server
  - ArticleStore in app-private storage; item ids are validated as plain file names
  - reading list and reader screens (headings, lists, quotes, code, AISH summary card)
  - unit tests against the article part of the shared vector, bomb and tamper checks; vector copy synced
  - README, .gitignore (*.jks, *.keystore)
- feat(inbox): Send to phone: full articles, end-to-end encrypted, to read on the go
  - second inbox (extension → phone), created with the pairing; the QR carries its id and read token (&ti=…&tr=…); the same key protects both
  - envelope v2: article as plain text blocks (no markup, no images), gzip, then AES-256-GCM; shortened to fit 135 KB; decompression capped at 4 MB
  - ⋯ → Send to phone on any article; Settings → Phone inbox can switch it on for an existing pairing
  - reference server and openapi: item cap 190,000 chars, 8 MB waiting per inbox, v 1|2
  - shared test vector for the article format (Android must decrypt it); tests 145, 146
  - translations for the new strings in 13 locales; cardMenu.js added to the i18n scan
- i18n: translate the three inbox strings (remove link, save timed out, page did not respond) in all locales
- feat(reader): Share and the preferred delivery (LocalSend or Kindle) from the reader page
- Monthly AI allowance: usage bar in account settings, friendly errors for quota/rate/size limits
  - renderQuota under the plan badge (percent only, warn at 80%, full at 100%), fed by the new quota field of GET /usage
  - quota_exceeded / rate_limited / too_large from the API get their own messages instead of the 'free daily limit' text
  - 5 new strings in 13 locales, test144
- ui(history): remove the Select button from the top bar (selection starts from a card's ⋯ menu or a long-press)
- feat(inbox): opening History checks the phone inbox (when paired), on top of the 15-minute background poll
- feat(feeds): items keep the identity they were first given (rewritten guids, tracking parameters and moved links no longer create duplicates)
- feat(inbox): waiting phone links are counted on the toolbar icon
- feat(inbox): the From phone chip stays: on the waiting card when its title arrives, and on the article it becomes (summary or saved copy)
- feat(inbox): an opened phone link takes over the page's title and description; Save only survives heavy pages
  - loader.js reports title/description of a page that waits in the inbox; the background applies it to that entry only (applyLinkMeta, a page may only describe itself); the card shows the title and a short description.
  - Save only: image inlining is capped at 25 s, each attempt at 70 s (retries without images), the service worker is kept alive meanwhile, and a failure shows its reason (timeout / detail).
- feat(inbox): phone cards open on click like the other cards (no separate Open button); Dismiss asks before deleting
- feat(inbox): phone links are native cards at the top of History's Inbox tab (no separate From-phone box)
- feat(inbox): Open a phone link from the list; Save only is more patient and says why it failed
  - Open ↗ button and a real link on the host/path; opening leaves the entry in the list.
  - saveFeedItem: settle delay after load, ensureContent + ping before saving, up to 3 tries; failures carry a reason (unreachable / empty / error) and the list explains each one.

#### Fixed

- Fix release gate: stale test expectations (Reset button, worker mock) and translations for the AI-reads settings
- fix(android): no To browser button on articles that came from the browser (kept on summaries made on the phone)
- fix(android): web view scrolling: take the remaining height with weight, explicit match-parent size, no parent intercepting the drag, zoom and wide viewport
- fix(android): a failed fetch counts as an attempt, so failed feeds really wait 6 hours
- fix(android): AddFeedDialog: plain suggestion rows instead of ListItem, braces around the result branches (second attempt at the Kotlin internal compiler error)
- fix(android): AddFeedDialog without delegated state and local fun (Kotlin internal compiler error), clearer URL constant name
- fix(android): centre the navigation rail items vertically on wide screens
- fix(android): request exact-alarm permission (USE_EXACT_ALARM) so the alarm can be set
- fix(android): crash guard: risky steps are marked, failures are caught and shown, and a next start after a crash opens a recovery screen
- fix(android): show and edit all feed tags from the extension instead of reducing them to one folder
- fix(phone): AI summary is sent as readable text (bullets), not raw HTML
- fix(history): the list re-reads the archive when it changes (a finished phone summary shows up without reopening)
- fix(history): archive and waiting phone links paint together after the skeleton

## 2.2.5 (2026-10-11)

### Commit log

#### Added

- Add connection map to exported digests (Kindle, LocalSend)

#### Changed

- i18n: translate the 5 new strings in all locales; missing translations only warn (UI falls back to English), broken placeholders still fail
- i18n: update translations for changed content
- chore(android): Gradle wrapper pinned to 9.6.0
- site: phone companion section with APK download
- ci(android): build and test the companion on changes; attach aish-companion.apk to every release
- feat(android): companion screen redesign (edge-to-edge, setup steps, paste on demand); version and release signing from the workflow
- feat(inbox): Save only for phone links (keep the page in History without the AI)
- feat(inbox): links stay on the server until summarized or dismissed (per-item delete with retry queue)
  - Polling no longer acknowledges (and so deletes) items; the server keeps them until the user summarizes or dismisses the link, so a lost profile or a second device can collect them again. New DELETE .../items/{itemId}; /ack is deprecated.
  - A failed delete stays queued in the state (toDelete) and is retried on every poll.
  - Unreadable and duplicate items are deleted right away; items summarized while the popup was closed are reconciled against History when the list renders.
  - Reference server and contract: per-item delete, 30-day item TTL.
- feat(inbox): clients call the renamed collection aish_inboxes (items: aish_inbox_items); restore the reader-page test as test136
- chore(android): keep the Studio-generated launcher icon, drop my duplicate adaptive-icon resources
- feat(android): companion follows the AISH look (design-token theme, light/dark) and gets the AISH launcher icon
- feat(inbox): phone links summarize like a feed card (progress ring, queue, leaves the list on completion, error shown)
- feat(ui): one clear (✕) button for every search box
- feat(inbox): phone inbox, collect links shared from a phone and summarize them with one tap
  - inboxCrypto / inboxManager / inboxView, inbox-worker.js bundle for the classic background script (built like feed-worker.js, listed in Firefox/iOS manifests)
  - qrcode-generator 1.4.4 (MIT) in src/lib
  - plugin/inbox-api: OpenAPI contract and a zero-dependency reference server
  - mobile/android: Kotlin/Compose share-target app (not yet built in Android Studio)
  - tests 129-131, shared wire-format vector (plugin/tests/fixtures/inbox-vector.json)
- feat(read): Read button opens a reader page (typography, themes, highlights, contents); stored HTML is sanitized
- Graph: Research-only filter chip; Markdown export includes the generated briefing
  - 🎓 Research chip (aria-pressed) next to Time in a shared filter bar; filters the graph to papers
  - Cluster/briefing pages remember generated answers; the .zip gets a Briefing note with [n] -> [[wikilinks]] and sources
  - Markdown button on the multi-topic/time briefing page
- a11y(graph): cluster and briefing pages use the shared sheet behaviour (dialog, focus trap, Escape, inert background); bar gets Escape, region label, live announcement
- feat(graph): brief several topics and/or a time window — selection on the graph, floating action bar, By topic / By time result
- feat(graph): cluster briefing drops duplicate URLs and summarizes >15 articles in groups, then merges the parts
- feat(graph): include opened articles in the cluster briefing via switch in the Opened group
- feat(graph): tap on a topic opens the cluster page directly (no peek bar), smaller mini map
- feat(graph): cluster peek bar → full cluster page (mini map, brief, never-opened list, docked ask, numbered sources)
- feat(graph): time window as histogram range (articles per month, overlaid From/To inputs, live count and chip label)
- Feeds: recap briefings render as markdown
  - Recap text is shown as formatted markdown (headings, bold, lists) in the day card, the recap sheet and the week/month roll-ups instead of raw ### and **
  - parseRecap keeps the line structure when a model answers with headings, so bullets stay under their heading
  - Headings glued into one line, "---" rules and a surrounding ```markdown fence are cleaned up
  - Single theme bullets support bold, italic and code through the shared inline renderer

#### Fixed

- fix(inbox): pairing QR no longer shows twice (settings panel renders off-screen, latest render wins)
- fix(summary): local models never need an API key (Ollama by any spelling, or a loopback / LAN endpoint); the error names the service and mode
- fix(ui): icons lead the label everywhere (Save button, trailing-emoji translations, flash/restore keep the icon)
  - labelNodes(): a mapped emoji at the end of a label (older translations: "Copy 📋", "Save 💾") now renders as a leading icon too; unmapped arrows such as ↗ stay trailing text.
  - Settings Save button: icon first in popup.html; the "Saved! ✓" flash and the Export "Exported! ✓" confirmation restore the button's nodes instead of its text, which used to drop the icon after the first flash.
- fix(feeds): graph topic page keeps its Brief button; graph stays put while a refresh runs
  - The preview-button relabel ("Open ↗") matched the cluster page's "Brief me" button, which shares the .graph-preview-open class; scope it to the article preview card's footer.
  - A refresh re-rendered the whole graph after every feed. Renders driven by the refresh are skipped while a graph is on screen (filters, search and view changes still go through); the final render updates it once.

#### Developer experience

- test: give cluster test more time for async briefing

## 2.2.4 (2026-10-10)

### Added
- **Auto summary length.** The default length now adapts to the article (about 4 × √words, never more than half the source) with a Shorter / Standard / Longer bias. Custom mode has a slider plus an exact number field (20–2000 words).
- **Process the whole Feed library with Ollama.** Rates, categorizes and recaps every stored feed item in batches (10 / 20 / 40, default 20), resumable, with live status. Works whenever Ollama is set up, even if another model is active for summaries. Optional automatic run every 15 min – 6 h while the Feeds screen or side panel is open. Linked under Settings › Library & Data › On-device tools.
- `LICENSE` (MIT), CI on pull requests (lint, tests, i18n check), generated `privacy.md` from the website policy, issue templates, `SECURITY.md`, `CONTRIBUTING.md`.

### Developer experience
- Tests: `npm test` runs only the tests a change can reach (import graph) and prints failures plus one summary line; timer waits are sped up (full suite ~42 s instead of ~118 s); the project-wide audits (translation coverage) and every test run in `npm run test:release`, on `main`, nightly and on tags. Pull requests no longer fail on missing translations.

### Fixed
- **Delete buttons now delete what their text says.** *Delete settings* previously cleared only synced preferences: API keys, license, sign-in, feeds and send targets stayed on the device. *Delete history* left highlights and feeds. Both now work by category with a checklist and counts, and there is a new *Delete all data*. Every storage key is owned by a category (a test fails otherwise).

### Changed
- Onboarding: free cloud models, my own API key and Ollama are three equal choices; the no-account ones open the model settings with the right tab selected. The empty state and onboarding show the keyboard shortcut.
- Settings › About links the privacy policy, the changelog and the security policy; fixed a broken link target there.
- History cards: status chips (New / Read / Sent / Archived) come before the type (research paper) and the tags.
- Privacy policy: one source (`site-src/pages/privacy.html`); Kindle delivery goes through the byPhil backend, LocalSend and the share sheet are direct.

### Commit log

#### Changed

- Feeds/History: back to top button
  - One floating button for both lists; appears after about a screen of scrolling and scrolls that list to the top
  - Same glass look as the reading tools, lifts above the podcast player and the selection bar
  - Stays out of the History detail view, which has its own reading tools
  - Translated in all locales; backToTop.js added to the i18n extraction list

#### Developer experience

- Release: changelog and release notes generated from commit messages
  - scripts/changelog.mjs reads the commits since the previous v* tag, groups them (Added, Changed, Fixed, Developer experience) and nests body bullets under their commit
  - release.yml writes the section into CHANGELOG.md with the version bump and uses it as the release body
  - A hand-written Unreleased section is kept; the commit log is added below it
  - Commit message convention documented in CONTRIBUTING.md
- Size: npm run size report and SIZE_AUDIT.md with the optimisation backlog

## 2.2.x (October 2026)
- Summary job queue in the background: one summary at a time across tabs and Feeds.
- Model panel split into byPhil Cloud, Own key and Ollama, with detection of installed Ollama models.
- Live recaps and scoring with progress; AI scoring tolerant of unstructured replies; no item cap on day recaps.
- Side panel attach / detach from the header; long-press a History card to select.
- Composer: page chip inside the input pill; close buttons for the chip panels.

## 2.1.x
- Security: sidebar `postMessage` token, extension-only background actions, escaped page-derived fields, no `eval` in bundled libraries.
- Test suite and lint in the repository and in the release workflow.
