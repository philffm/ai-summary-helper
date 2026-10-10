# Contributing

Thanks for helping. The extension is vanilla ES modules (no framework, no bundler for the popup). The README has the architecture; this is the short version of how to work on it.

## Setup

```bash
git clone https://github.com/philffm/ai-summary-helper.git
cd ai-summary-helper
npm ci
npm run build        # plugin/src → plugin/dev/aish-extension-chrome (also build:firefox, build:android, build:ios)
npm test             # only the tests your change can reach (import graph), quiet: failures + one summary line
npm run lint         # eslint plugin/src
npm run size         # where the package bytes go (see plugin/SIZE_AUDIT.md for the optimisation backlog)
```

**Which test command when**

| When | Command |
| --- | --- |
| while working | `npm test` (affected tests, a few seconds; `-- --list` shows which and why, `-- 12 37` picks tests, `-- --verbose` lists every test) |
| before opening a pull request | `npm test -- --deep` (follows every import; what CI runs on pull requests) |
| before a release | `npm run test:release` (every test, the audits, and `node scripts/feed-i18n.mjs check`; CI runs it on `main`, nightly and on tags) |

Please do not run the full suite after every small edit. Translations for new strings may be added later: untranslated strings fall back to English and only the release gate requires every locale to be complete (`node scripts/feed-i18n.mjs extract`, translate, `merge <dir>`).

Tests wait in real time less than they used to: `plugin/tests/env.mjs` divides timer delays by `AISH_TEST_SPEED` (default 8, `1` = off). A test that depends on real timing starts with `// @realtime` in its first lines; a project-wide check that should only run for releases starts with `// @audit`.

Load `plugin/dev/aish-extension-chrome/` via `chrome://extensions` › *Developer mode* › *Load unpacked*. Pull requests run lint and the affected tests in CI; `main`, tags and a nightly run everything.

## Commit messages and the changelog

Release notes are generated from the commit messages between two versions (`scripts/changelog.mjs`, run by `release.yml`; it also adds the release to `CHANGELOG.md`). Write commits so they read well as a changelog line:

```
Scope: what changed for the user, in one line

- optional detail, one point per line
- a wrapped line continues the bullet above if it is indented
```

- The subject becomes the entry. `Tests:`, `CI:`, `Docs:`, `Build:`, `Size:`, `Chore:` and `Refactor:` go under *Developer experience*; subjects starting with `Add` / `Fix` go under *Added* / *Fixed*; everything else is *Changed*.
- Merge commits, the bot's version bumps and non-descriptive subjects (`up`, `wip`) are left out; the notes say how many were.
- Preview: `node scripts/changelog.mjs --version 2.2.4` (prints; add `--from <tag>` to pick the start). Highlights that need a sentence of explanation can still go into `## Unreleased` in `CHANGELOG.md`; the release keeps that text and adds the commit log below it.

## Conventions

- **No framework.** Build DOM with `modules/dom.js` (`el(...)`); anything page-, feed- or model-derived that reaches `innerHTML` goes through `escapeHtml` / `cleanUntrustedHtml` (`modules/textUtils.js`). Prefer `textContent`.
- **Strings:** wrap user-visible text in `T('English text')` (the English text is the key). Add the new strings to all locales: `node scripts/feed-i18n.mjs extract`, translate, `merge <dir>`. Missing translations do not fail a pull request; `test60` (an audit) and the release gate require every locale to be complete.
- **Storage keys** are defined once in `modules/storageKeys.js`; after editing run `node plugin/scripts/sync-storage-keys.mjs` (the service worker has a generated copy).
- **Styles:** use the tokens in `styles.css` (colours, radii, font sizes, spacing); no hard-coded colours in new CSS or inline styles. See `plugin/STYLE_AUDIT.md`.
- **Tests:** add a `plugin/tests/testNN.mjs` for new behaviour (first comment line = what it covers). A fix should come with a test that fails without it.
- **Privacy policy:** edit `site-src/pages/privacy.html`, then `npm run privacy:build` to refresh `privacy.md` and `plugin/src/privacy.md`.
- Keep pull requests small and focused; describe what changed and how you checked it.

## Adding things

- **A provider:** add it to `plugin/src/services.json` (id, name, endpoint, default model, whether a key is needed).
- **A language:** add `plugin/src/_locales/<code>/messages.json` and the entry in `current_version.json`, then run the i18n merge/check.
- **A setting:** key in `storageKeys.js`, UI in `popup.html` + the matching `*Manager.js`, entry in `settingsNav.js` so it shows up in the settings search.

## Reporting bugs and ideas

Use the issue templates. For security problems see [SECURITY.md](SECURITY.md).
