# Contributing

Thanks for helping. The extension is vanilla ES modules (no framework, no bundler for the popup). The README has the architecture; this is the short version of how to work on it.

## Setup

```bash
git clone https://github.com/philffm/ai-summary-helper.git
cd ai-summary-helper
npm ci
npm run build        # plugin/src → plugin/dev/aish-extension-chrome (also build:firefox, build:android, build:ios)
npm test             # jsdom suite; `npm test -- 12 37` runs single tests
npm run lint         # eslint plugin/src
node scripts/feed-i18n.mjs check   # every UI string translated in every locale
```

Load `plugin/dev/aish-extension-chrome/` via `chrome://extensions` › *Developer mode* › *Load unpacked*. Pull requests run lint, tests and the i18n check in CI; please run them first.

## Conventions

- **No framework.** Build DOM with `modules/dom.js` (`el(...)`); anything page-, feed- or model-derived that reaches `innerHTML` goes through `escapeHtml` / `cleanUntrustedHtml` (`modules/textUtils.js`). Prefer `textContent`.
- **Strings:** wrap user-visible text in `T('English text')` (the English text is the key). Add the new strings to all locales: `node scripts/feed-i18n.mjs extract`, translate, `merge <dir>`. `test60` fails when a locale is missing a string.
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
