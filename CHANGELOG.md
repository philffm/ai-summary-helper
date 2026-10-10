# Changelog

Notable changes, newest first. Versions follow `current_version.json`; releases are cut by `.github/workflows/release.yml`.
Commit history has the details: <https://github.com/philffm/ai-summary-helper/commits/main>.

## Unreleased

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
