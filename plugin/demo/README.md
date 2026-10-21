# Live demo — URL parameters

The live demo at `https://ai-summary-helper.byphil.eu/demo/` runs the **real extension UI**
(`plugin/src/popup.html`) inside an iframe, with a mock `chrome` API that replays recorded
content. Everything is deterministic and offline: no network, no API key, no model call.

This document is the contract for **automation** — screen recorders, video tools, screenshot
pipelines, and embedding. Every parameter is optional and composable.

---

## Quick reference

| Parameter | Values | Default | Effect |
|---|---|---|---|
| `lang` | `en`, `de`, `fr`, `es`, `pt`, `zh`, `zh-tw`, `ja`, `ko`, `hi`, `vi`, `nl`, `it`, `ru`, `uk`, `tr`, `id`, `pl`, `th`, `ar`, `sv`, `da`, `no`, `fi` | `en` | UI language, summary language, and the sample article |
| `theme` | `light`, `dark` | OS preference | Force a colour scheme |
| `tour` | `0`, `1` | show once, then remember | `0` hides the guided tour, `1` forces it |
| `chrome` | `0` | framed | `0` = product only: no sample page, title bars, borders, padding or background |
| `article` | `0` | shown | `0` = keep the framed panel, hide the sample article |
| `layout` | `stack` | side by side | `stack` = sample article above the product, at any width (vertical video) |
| `clock` | `manual` | real time | `manual` = virtual clock: nothing streams until the host calls `AISH_CLOCK.advance(ms)` (frame-exact capture; see the next section) |
| `surface` | `popup`, `sidepanel` | `sidepanel` | Which surface the popup renders as |
| `screen` | `main`, `history`, `feeds`, `settings` | `main` | Open that screen on load |
| `panel` | see below | — | Open a settings panel (implies `screen=settings`) |
| `scenario` | `youtube`, `pdf`, `paper`, `research`, `mood`, `instant`, `ghost` | — | What the extension "sees" and what is already saved (see below). English content only. |

Base URL: `https://ai-summary-helper.byphil.eu/demo/`

---

## Recipes

### Product only, no chrome — for a hero shot or a video overlay

```
/demo/?chrome=0&tour=0&theme=dark
```

Renders the extension UI alone: no sample article, no window title bars, no borders, no
padding, transparent background. The iframe fills its container, so you can size it to your
composition and composite it over your own background.

### Product only, on a specific feature

```
/demo/?chrome=0&tour=0&theme=dark&screen=history
/demo/?chrome=0&tour=0&theme=dark&screen=feeds
/demo/?chrome=0&tour=0&theme=dark&panel=appearance
```

### Framed panel, no article — a clean popup card

```
/demo/?article=0&tour=0&theme=light
```

Keeps the rounded panel with its title bar, drops the sample article, and centres the panel at
popup width. Good for a "this is the product" card without the fake browser page.

### Full demo with the guided tour, in German

```
/demo/?lang=de&theme=dark&tour=1
```

### Popup surface instead of the side panel

```
/demo/?surface=popup&chrome=0&tour=0
```

---

## Scenarios (`scenario=`)

The default demo is one article. A scenario (defined in `demo-scenarios.js`, all content made up) swaps the page and the saved data,
so a feature can be shown that the default cannot:

| `scenario` | Shows |
|---|---|
| `youtube` | A YouTube watch page (captions as transcript): summary, follow-up with a source in the transcript |
| `pdf` | A long PDF in a viewer: summary, "What I used" (words, tokens), follow-up with a source |
| `paper` | A journal article with a DOI: 🎓 chips on the summary, Research tab, key facts, citation (DOI lookup answered from recorded CSL) |
| `research` | The research library plus a collection ("Do naps help learning?") with five typed sources; "Create overview" streams agree / disagree / missing |
| `mood` | AI-rated feeds (good-mood filter) and ~4 months of mood history for Feeds → Insights |
| `instant` | A fake speech engine, so Instant read (🔊 chip, reading bar) works |
| `ghost` | After a summary the AI's ghost highlights appear in the article; click one for Keep / Dismiss |

Combine with the other parameters, e.g. `/demo/?scenario=paper&chrome=0` or `?scenario=research&screen=history`.

---

## Settings panels (`panel=`)

`account`, `models`, `prompts`, `feeds`, `feedprefs`, `reading`, `send`, `phoneinbox`,
`appearance`, `accessibility`, `library`, `about`

`panel=` implies `screen=settings`; you do not need to pass both.

---

## Embedding

The demo is designed to be iframed. For a borderless product view:

```html
<iframe
  src="https://ai-summary-helper.byphil.eu/demo/?chrome=0&tour=0&theme=dark"
  title="AI Summary Helper"
  style="width:420px;height:760px;border:0;background:transparent"
  loading="lazy"></iframe>
```

Notes:

- `chrome=0` sets the page background to `transparent`, so the host page's background shows
  through. Set `background:transparent` on the iframe too.
- The demo is `noindex,follow` and is not in the sitemap.
- The popup inside is same-origin with the demo page, which is why the tour can reach into it.
  If you embed the demo on a **different** origin, the tour still works (it lives on the demo
  page) but you cannot script the inner popup from your page.

---

## Automation hooks

These are stable entry points for a video tool that needs to drive the demo rather than just
load a URL.

### `?clock=manual` — virtual clock (frame-exact capture)

With `clock=manual` the mock schedules every delay (summary stream, answer deltas, replies) on a virtual
clock that only moves when the host asks. Inside the popup window:

```js
popupWindow.AISH_CLOCK.advance(4000)   // run everything due up to t = 4000 ms
popupWindow.AISH_CLOCK.now()           // current virtual time
```

`Date.now()` follows the virtual clock and programmatic scrolls are instant, so the same virtual time
always produces the same screen.

Two readiness helpers for hosts that start clicking right after load:

```js
popupWindow.AISH_CLOCK.localesLoaded()  // finished _locales/*.json requests; >= 2 (English fallback + UI language) = translated
popupWindow.AISH_CLOCK.busy()           // true while a same-origin request is in flight
```

Wait for both before the first interaction. Otherwise a capture that starts late can click before the UI is translated. Time only moves forward: to go back, reload and replay from 0. The video
project (`videos/`) drives the demo this way.

### `window.AISH_TOUR` (on the demo page)

```js
AISH_TOUR.start()   // start the guided tour from step 1
AISH_TOUR.end()     // dismiss it
```

### `window.AISH_DEMO` (on the demo page)

The recorded content, so a tool can assert on what is on screen:

```js
AISH_DEMO.tab.url          // the fake active tab
AISH_DEMO.article.title    // sample article title
AISH_DEMO.article.paragraphs
AISH_DEMO.summary.html     // the summary that streams in
AISH_DEMO.library           // 27 history entries
AISH_DEMO.feeds             // subscriptions + items
```

### `postMessage` — theme

The demo page forwards theme changes into the popup. A host page can do the same:

```js
iframe.contentWindow.postMessage({ aishDemo: true, type: 'theme', theme: 'dark' }, '*')
```

### `postMessage` — highlight

When the popup reveals a quote, it posts to the demo page, which highlights it in the sample
article:

```js
{ aishDemo: true, type: 'highlight', quote: '…' }
```

---

## Determinism

Everything the demo shows is recorded, not generated:

- The summary streams word by word on a fixed timer, then completes.
- Follow-up answers stream from `AISH_DEMO.asks`.
- History dates are relative to "now" (`daysAgo`), so the list always looks recent.
- No network requests leave the page; `fetch` to any external host rejects with
  `TypeError('offline demo')`.

This means a recording is reproducible: the same URL produces the same frames.

---

## What is deliberately missing

The demo hides anything that would break or confuse outside a real extension:

- Docking / undocking the side panel, "open in tab"
- Destructive resets, settings import/export, licence activation
- Model and phone-pairing setup
- Storage tools
- Export formats that need a real browser download (Obsidian, ODT/DOCX, PDF)

If a video needs one of those, it has to be staged separately.

---

## Building locally

```bash
node plugin/scripts/build-demo.mjs          # build into plugin/dist/demo/
node plugin/scripts/build-demo.mjs --check  # build + verify the mock covers every popup action
```

Serve `plugin/dist/demo/` over HTTP (the popup is an ES-module page, so `file://` will not
work):

```bash
cd plugin/dist/demo && python3 -m http.server 8899
# http://localhost:8899/index.html?chrome=0&tour=0
```

The Pages workflow publishes this directory under `/demo/`.
