# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately:

- GitHub: *Security* tab › *Report a vulnerability* (private advisory), or
- Email: philipp@wornath.de

Include what you found, how to reproduce it, the browser and extension version (Settings › About). I aim to answer within a few days.

## Scope

The extension (`plugin/`), the bookmarklet generator and the website (`site-src/`, `docs/`). Of particular interest:

- Anything that lets a web page or feed read the user's API keys, license key, history or highlights.
- Script injection through page-, feed- or model-derived content (summaries, titles, tags, recaps).
- The messaging between the content script, the in-page sidebar and the extension (`sidebarChannel.js`, `EXTENSION_PAGE_ACTIONS` in `background.js`).
- Prompt injection that makes the extension take an action the user did not ask for.

The byPhil backend (`api.byphil.eu`) is a separate service; reports about it are welcome at the same address.

## What the extension protects

- API keys and the license key stay in `chrome.storage.local` and are never synced.
- Content from pages and feeds is escaped or cleaned before it is rendered (`textUtils.js`: `escapeHtml`, `cleanUntrustedHtml`).
- Background actions that spend the AI key or fetch for the extension refuse content scripts.
