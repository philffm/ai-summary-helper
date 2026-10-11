# Changelog

Notable changes, newest first. Versions follow `current_version.json`; releases are cut by `.github/workflows/release.yml`.
Commit history has the details: <https://github.com/philffm/ai-summary-helper/commits/main>.

## Unreleased

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
