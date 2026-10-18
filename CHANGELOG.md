# Changelog

Notable changes, newest first. Versions follow `current_version.json`; releases are cut by `.github/workflows/release.yml`.
Commit history has the details: <https://github.com/philffm/ai-summary-helper/commits/main>.

## Unreleased

## 2.2.20 (2026-10-18)

### Commit log

#### Added

- Add locales sv, da, no, fi
- Add locales nl, it, ru, uk, tr, id, pl, th, ar (RTL support for Arabic, banner entries, poster fallback)
- Try it: Add to Chrome button under the demo

#### Changed

- i18n: update translations for changed content
- translate: retry up to 3x and tolerate concatenated/array JSON responses from the model
- test59: sv is a supported UI locale now; use he-IL as the unsupported example, assert new locales and nb/nn -> no
- Update feed i18n report
- Extension: Finnish UI translation (fi)
- Extension: final Ukrainian revisions
- Extension: Ukrainian UI translation (uk); final pl and tr revisions
- Extension: Polish and Turkish UI translations (pl, tr)
- Extension: Swedish UI translation (sv)
- Extension: Dutch UI translation (nl)
- Extension: Thai UI translation (th)
- Extension: Danish and Norwegian UI translations (da, no)
- Extension: Indonesian UI translation (id)
- Extension: register UI locales nl, pl, tr, id, th, uk, sv, da, no, fi (language list, picker, AI tag language names)
- SEO/GEO: run seo pass (canonical, JSON-LD, sitemap, llms.txt on all pages), Firefox + Android beta + demo in structured data and llms.txt, demo noindex
- Language banner: works on every locale page, text in the suggested language, adds zh-tw and vi, links to the same page
- i18n: update translations for changed content
- Android companion: Beta badge on eyebrow and download button
- Hero scene: real extension icon instead of the placeholder logo
- Hero scene: remove logo from the panel header
- Hero: drop cursor label (caption under the slide is enough)
- Hero: remove left step list (captions carry the steps)
- Hero: knowledge-graph card no longer cut off (wider, single-line stats, shorter chart)
- Hero scene and bookmarklet mock: dark theme
- i18n: update translations for changed content
- Hero: cursor carries a label with the current step title
- Hero: step title + sentence shown above the slide indicator; step list more readable
- Store links follow the browser (Firefox -> AMO), second store as secondary button under the demo
- Demo poster: no dimming, button gets its own backdrop
- Demo: real screenshot poster (per language and theme) behind the play button
- Pricing: wider tier cards (up to 1100px), roomier padding, single column under 900px
- Hero walkthrough: wrap long localized strings inside article and tab bar
- Hero walkthrough: localized per language (local satire story, UI strings, step captions, language pills)
- See it: bigger, more readable slide captions
- Demo: larger and responsive (breaks out of the column up to 1640px, height follows the viewport; panel and type scale with width)
- Hero: autoplaying presenter-style walkthrough with cursor + extension toolbar instead of scrollytelling
- Hero is now one block: real hero text + switch + Add to Chrome on the left, scroll-reactive scene on the right (full bleed)
- Hero: Variant A scroll scene back, now full bleed; live demo back in its own 'Try it' section; Bookmarklet tab keeps the explainer
- Hero: full-bleed live demo replaces the hero image/scene; Bookmarklet tab explains the flow
- Restore the 'See it' peek carousel (revert scrollytelling); keep the new scroll hero
- Hero: native scroll-reactive scene replaces the hero screenshot
- feat(site): 'See it' becomes native scrollytelling (sticky screenshot, steps scroll past and swap the image)
- i18n: update translations for changed content
- site: locale folders move from /lang/<code>/ to /<code>/, old URLs redirect via deploy-time stubs
  - docs/lang/* -> docs/*; locales.json dirs, hreflang, canonical, sitemap and the language banner follow
  - scripts/legacy-lang-stubs.mjs writes meta-refresh + canonical stubs for every old /lang/... URL into the Pages artifact (not committed)
  - seo.mjs reads the locale folders from locales.json; links from translated pages to untranslated ones point to the English page instead of a 404
- seo: titles under 60 characters, descriptions under 160, four more blog posts queued for translation
- feat(seo): drop dead hreflang alternates, add og/twitter fallbacks, JSON-LD (WebSite, SoftwareApplication, FAQPage, BlogPosting) and llms.txt
- feat(demo): seed six feed subscriptions with recent items
- feat(demo): seed 27 dated articles so History, Graph and Analytics show real data
- translate
- feat(site): 'Try it' section that starts the live demo on click
- feat(demo): live in-site demo of the real popup (fake chrome + recorded content), built to plugin/dist/demo and deployed by a Pages workflow
- style(site): centre the icons in the ecosystem cards
- spike(demo): fake chrome shim boots the real popup and renders a mock summary
- feat(site): larger full-bleed gallery, selectable captions, native touch panning
- Landing: "See it" becomes a peek carousel (scroll-snap, dots, arrows, keyboard)
- Streaming: resync after a missed delta instead of freezing the preview
- Prompt: "make it yours" in onboarding, mindset and about-me tags in the builder
  - promptBuilder: optional lens (Stoic, Skeptic, Optimist, Pragmatic) and up to 8 free tags ("UX designer", "parent of two"); both only present when set, so stored builders keep their shape. Added to the generated prompt.
  - Onboarding style step: after picking a style, chips for mindset, interests, length and own tags; the example updates live and the prompt is viewable. It stores the same promptBuilder keys as Settings, so everything stays editable there.
  - Settings > Prompts: Mindset and About you groups; the generated prompt sits behind "Show prompt" for the builder, always visible for presets/custom. Shows what onboarding stored after the screen was already open.
  - Tests 175/176 (renamed from test_*.mjs, which the runner never picked up).
- Android: read full screen on wide screens (fold): the list and navigation rail step aside, toggle in the top bar, back returns
- Silent login renewal: swap a token close to expiry instead of signing out
- Android: morning briefing is fetched when the alarm rings if the night job was held back, and an empty briefing says why
  - AlarmService refreshes the feeds (foreground service, has network) when the prepared briefing is missing, stale or empty; the ring screen picks the result up
  - empty briefing shows and speaks a reason: feeds last refreshed, failing feeds, newest story, unread count, and the battery-setting hint when the phone has not refreshed for 12 h

#### Fixed

- Demo: works on every language page (404 fixed) and follows the site's language and light/dark theme
  - translate.mjs rewrites demo/ links and data-src for locale folders; built pages fixed (../demo/index.html)
  - demo gets ?lang=…&theme=…: extension UI language, summary language, localized article/summary/answers for 10 locales (demo-i18n.js), theme applied live when the site toggles
- fix(site): the hero image no longer appears twice (first carousel slide removed, 4 slides left)

#### Developer experience

- Docs: hero visual replaces the banner in the README; version badge follows the latest release
- Docs: drop the "How it works" walkthrough image from the README
- Docs: use press kit assets in README and landing page
  - README: 2.2 badge and pitch, hero visual, At a glance, screenshot gallery, research mode, split view, 41/14 languages (assets/press/)
  - Landing page: hero visual, "See it" screenshot section, og:image and Twitter card (docs/assets/shots/, WebP)
  - translate.mjs: swap "-en.webp" screenshots for "-<locale>.webp" when the file exists, else keep English
- chore: refresh feed i18n report (1568 strings)

## 2.2.19 (2026-10-15)

- **Your own OpenAI-compatible server.** Settings › Models: a new provider "OpenAI-compatible server" for LM Studio, llama.cpp, vLLM, LiteLLM, Open WebUI, LocalAI, Jan or Ollama via `/v1`. Enter `https://host/v1` (or the full `…/chat/completions`), an optional key and a model name; the model list is read from `/models` when the server offers it. Background jobs (Feed rating, recaps) stay on Ollama.
- **Internal: foundation for send targets (no visible change).** A background outbox with retry, a per-target ledger and a restricted fetch for future adapters (WebDAV and others). Nothing is sent yet and no existing setting or data is touched. Backups never contain the send queue.
- **Send to Obsidian: vault and folder.** Settings › Send & Share › Obsidian: optional vault name and folder; the note opens there (`vault=` / `file=`). The file name is the same stable name as in the archive export.

- **Notes: one front matter schema, a stable id.** Markdown notes from the extension (single article and archive export) and from the Android app use the same keys: `title`, `source`, `author`, `site`, `created`, `tags`, `mood` (extension), `aish_id`, `aish_format: 1`. `url` and `date` stay as copies of `source` and `created` for a transition period; they will be removed in a later release, so update Dataview queries to `source` and `created`.
- **Archive export: file names no longer depend on the order of the archive.** The oldest article with a title keeps the plain name, later ones with the same title get ` (<id tail>)` instead of a running number, so exporting again into the same folder does not rename or overwrite other notes. Notes without a title are `Untitled (<id tail>)`.
- **Exchange format documented:** AISH Article JSON v1 (`plugin/formats/article-json-v1.md`). The phone envelope v2 gets an optional `aid`.

### Commit log

#### Changed

- Send & Share: native SVG icons in the target list, split-button colours
- i18n: pt_BR and zh_HK as own locales, store listing per market
- Send targets: foundation (outbox, ledger, restricted fetch), no visible change
- Cloud: never send an expired login token
- Perf: targeted storage reads, streaming deltas, fewer feed redraws
  - authManager, storageManager, modelManager, readerPage: read only the keys needed instead of getAll()/get(null) (which pulled every article record)
  - inboxView: debounce storage.onChanged redraws
  - aiProgress: send the new text part (delta + offset) per tick instead of the whole text; feedAi rebuilds it and drops a delta that does not continue
  - feedManager: redraw the list on feedBackground changes only when items, ratings or recaps changed (status-only writes update the settings view)
- Own OpenAI-compatible endpoint (service custom): URL normalisation, model list, key optional, parsers, error hints
- Obsidian: vault and folder settings, stable note name, tested URI builder
- Notes: AISH Article JSON v1, stable file names and aish_id; one front matter schema in extension and Android; optional aid in the phone envelope
- i18n: update translations for changed content

#### Fixed

- Fix CI: build.js writes targets-worker.js; test168 no longer compares gzip bytes
  - build.js was marked skip-worktree locally, so the targets-worker step from the send-targets commit never reached the repo (test173 failed in CI). Only that step is committed; the local white-label (brands) edits stay uncommitted.
  - test168 compared the sealed phone envelope byte for byte, which depends on the zlib version (Node 22 in CI vs 26 locally). It now checks version, nonce and that both envelopes decrypt to the same message.
- Fix: model list probe for own server used an out-of-scope variable (pass the key in)

#### Developer experience

- chore: version 2.2.18

## 2.2.14 (2026-10-14)

### Commit log

#### Changed

- Store listing per market, localized context menu, CJK word count, neutral default prompt

## 2.2.13 (2026-10-14)

### Commit log

#### Changed

- Settings: KOReader / LocalSend appears once as the send-target title (drop the second heading with the icon)
- Send from the article toolbar is held back 10 s with an Undo toast
- Send menu: list paired devices per send type (max 3, rest behind "N more…")
- Settings: Send & Share as a target list (Kindle, LocalSend, Phone inbox, Share)
  - Target list with status and a "Default" tag; each target opens its own form (ids unchanged)
  - Default target switch drives the existing deliveryPreference
  - Settings search jumps straight to the right target form
  - Bookmarklet generator stays on the list view
  - i18n (de) + test167
- Article view: source card, joined configurable toolbar, Send split button
  - Source card with DOI entry, key facts open by default when a DOI exists
  - Joined toolbar (Read/Copy/Favorite/Listen/Send/...) configurable by drag & drop in the article view, adapts to width
  - Send split button (Kindle, LocalSend, phone, share) with remembered last target
  - Graph top row: research/time chips aligned next to the view toggle
  - Storage cleanup, bulk send actions, card menu scrolling
  - i18n keys for all locales, tests 30/69/164-166
- Android test: the broken-item-file test calls the archive helper with its timestamp (CI did not compile the unit tests)
- Contact address is info@byphil.eu in SECURITY.md and the translated privacy pages
- Privacy: name OpenRouter as the route to the models behind byphil Cloud
- Privacy: contact address is info@byphil.eu
- Privacy: controller, legal bases and retention per purpose, recipients (IONOS Germany, Stripe, model provider), third countries, full rights list and complaint right
- Privacy: say precisely what byphil Cloud relays vs. records (usage metadata only), account optional
- Account: link to byphil.eu/#account (export data, delete account) from the extension account settings, the Android account screen and the privacy policy
- Site: goodbye and privacy sources carry the Matomo uninstall feedback (docs/ is built from site-src, so the Formbricks text came back)
- Privacy: regenerate plugin/src/privacy.md from the site source
- Extension: tab indicator keeps sliding — a resize that does not move the target no longer snaps it
- Extension: History selection (also in Archive) can add the selected articles to a collection
- Extension: collections (Sammlungen) — add sheet with last-used preselected, Collections tab, source profile and lateral-reading check
- Android: shared links wait in a queue while a page is open; stored feed items survive a broken write and always show; good-news alarm falls back to the latest good news
  - share sheet: links arriving while a page is open are queued (Next / Skip to next bar) instead of replacing it; each link gets fresh page state
  - FeedStore: item files written atomically with a .bak, read falls back to it (a cut-off file no longer shows an empty list or wipes the archive)
  - AppModel: refresh always reloads what is stored, a failed vault sync no longer stops it; reload on resume
  - Briefing: good-news-only with nothing positive in 7 days uses the latest positive stories, read or not, however old, and says so
- Android: a link shared while the app is open replaces the page instead of getting lost (onNewIntent was ignoring it)
- Improve button sizing
- Android: bottom app bar, medium title in settings, fade-through list/detail, in-app light/dark and wallpaper colours, state descriptions and live regions
- Android: one AishCard, theme roles instead of raw colours for highlights and done state, secondary with 4.5:1 text
- Android: accessibility — TalkBack actions for swipes, headings, high contrast, reduce motion, stronger outline
- Android: negative mood is a crying face
- Android: predictive back, shape tokens instead of magic radii, Material icons instead of emoji in settings and onboarding
- Site: uninstall feedback goes to Matomo as events instead of opening a mail window
- Android: highlight paragraphs in the reader (long press), animated list changes
- Android: Hanken Grotesk app font, reader typeface/spacing/background sheet, easy-read face
- Android: summarize and remind from the reader, listen to feed items, reminder notifications
- Android: read aloud, speed reading, Markdown copy/share, archive, search and settings backup in the reading list
- Extension: Markdown/Obsidian/ODT/Word export loads the original text for list entries
- Extension: article detail drops the .MD button and gets the full ⋯ menu
- Extension: tab view uses the full window width
- Extension: open the app in its own tab, and as a floating panel from the reader
- Extension: instant read volume bar draws its fill
- Extension: onboarding test covers the style step; guard scrollIntoView
- Extension: onboarding step 2 — choose a summary style and see an example
- Extension: instant read is toggled by the toolbar icon, controls (pause, mute, volume, speed) appear once speech starts
- Extension: export as OpenDocument text (.odt) first, Word (.docx) second
- Extension: summarize YouTube videos from their captions
- Extension: send to Obsidian, export as Word and PDF, read aloud in the reader page
- Extension: podcast player tokens all derive from semantic tokens
- Extension: --player-bg derives from the semantic --sheet-bg token (themes and brands follow)
- Extension: strip a trailing check/star from icon labels, so 'Saved! ✓' shows one checkmark
- Extension: read-aloud speaks foreign-language quotes with a matching voice language
- Extension: follow-up questions stay in the summary's language

#### Fixed

- test159: wait for the read-aloud queue to finish instead of a fixed 80 ms (flaked on slow CI)

#### Developer experience

- CI: flaky tests found on main/nightly become one issue per test (comment on recurrence, label flaky)
- Tests: a failed test is run once more alone; passing on retry is reported as flaky (warning + CI summary) instead of failing the run

## 2.2.10 (2026-10-13)

### Commit log

#### Added

- Add gradle files

#### Changed

- Extension: briefings stream live, can be read aloud (while writing and after), and can always use the local model
- Extension: recap status shows the cloud model name
- App: Pro extra lives inside Morning alarm settings, not as its own category
- App: allowance card like the extension (title + % left, bar, note, collapsible usage details)
- Extension: any vendor/model id can be typed in the cloud pick; suggestion caption on its own line; no duplicate suggestions when renders overlap
- Extension: quick model pick shows the 5 best value models (popularity + price), translated
- Extension: quick model pick suggests the most popular and the cheapest models, translated
- Allowance shown as what is left (percent and shrinking bar) in the app and the extension
- Extension: OpenRouter price per million tokens in the cloud model list, translated
- Usage: show percent, requests and tokens only; no money amounts in the app or the extension
- Extension: collapsible usage details under the AI allowance (cost, requests, tokens, per model), 13 locales
- Alarm: read the briefing with the voice of the chosen language, show the written briefing on screen, cloud extra in the chosen language
- Account: AI use this month (cost, requests, tokens, per-model) plus on-device and cloud call counters
- Recap and briefing in one language: the Settings choice, else the phone's; other-language headlines are translated
- Release workflow: Gradle 9.6.0, as the Android plugin requires (and as android.yml uses)
- Home-screen widget with the day recap
- Podcast: sleep timer with fade-out, download episodes for offline (resumable, 400 MB cap), storage row
- Two-column Settings on wide screens, row-style alarm/model/extras cards, share with key passages
- Recap: say why there is nothing (no feeds, not refreshed, unreachable) and when the phone last refreshed
- First-run card with suggested feeds, OPML import/export, Storage panel (clear old items, delete other models, clear cache); remove A-/A+ from the reading bar
- Keep an offline archive of feed items (30 days), date undated items when first seen, never wipe on an empty answer; recap falls back to three days
- Rank stories for the day recap and morning briefing by how many sources carry them, plus recency, stars and feed spread
- Choose the on-device model: quick phone check recommends one, Qwen3 0.6B / Gemma 4 E2B / Phi-4 mini / Gemma 4 E4B, speed test, <think> stripping
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

## 2.2.9 (2026-10-12)

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
