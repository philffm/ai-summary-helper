<link href="style.css" rel="stylesheet">
<!-- # ![Icon](src/icons/icon48.png) AI Summary Helper  -->
<h1 style="display: flex; align-content: center; align-items: center; gap: 12px;"><img src="icon.svg" style="width:48px; height:48px">AI Summary Helper</h1>

>You are on the hunt for interesting articles around the web, open 100 tabs and end up… not reading them. Sounds familiar?

Summary Helper allows to summarize articles with a custom prompt - so it can be as tailored to your language, profession or point of view as you define it. The summary gets inserted in the content area itself. This way you can easily forward the article including the generated summary to your Kindle device e.g. using [Reabbles Send-to-Kindle tool](https://send.reabble.com/). 

<a href="https://www.producthunt.com/posts/ai-summary-helper?embed=true&utm_source=badge-featured&utm_medium=badge&utm_souce=badge-ai&#0045;summary&#0045;helper" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=461601&theme=dark" alt="AI&#0032;Summary&#0032;Helper - Instantly&#0032;summarize&#0032;all&#0032;the&#0032;web&#0032;content&#0032;your&#0032;browse | Product Hunt" style="width: 250px; height: 54px;text-align: center;" width="250" height="54" /></a> 
<a href="https://chrome.google.com/webstore/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb" target="_blank"><img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/iNEddTyWiMfLSwFD6qGq.png" alt="Chrome Web Store" style="width: 206px; height: 58px;text-align: center;" width="206" height="58" /></a><a href="https://philffm.github.io/ai-summary-helper/bookmarklet-generator/" target="_blank"><img src="assets/createBookmarklet.svg" alt="Create Bookmarklet" /></a>


>On the go I am way more likely to engage with the content I intentionally selected earlier. The tailored briefing then helps me to recall why I chose the article, suggests me books and other media related to it. 

![AI Summary Helper](assets/aish.png)

**Variant A:** [Create your Bookmarklet](https://philffm.github.io/ai-summary-helper/bookmarklet-generator/) 
- Browser & OS-agnostic, even works on iOS 

![Demo](bookmarklet-generator/demo.gif)

**Variant B:** [Download Chrome Browser Plugin](https://chromewebstore.google.com/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb)


## Overview

This project includes two components:
- **Chrome Extension**: A browser plugin for generating AI summaries of web content.
- **Bookmarklet Generator**: A tool for creating bookmarklets that provide AI summaries.

|  | Bookmarklet  | Browser Extension |
| --- | --- | --- |
| OpenAI | ✅ | ✅ |
| Mistral AI | ✅ | ✅ |
| Ollama (Local) | ❌ | ✅ |
| Custom Prompt | 🟠 Initially set base prompt | ✅ Base + custom prompt per request|
| Cross Platform | ✅ | ❌|
| Text Highlighting | ❌ | ✅ |
| Article History & Archive | ❌ | ✅ |
| Save for Later (Tab Close) | ❌ | ✅ |
| Context Menu Actions | ❌ | ✅ |
| Backup & Restore | ❌ | ✅ |


## Project Structure

```
ai-summary-helper/
├── src/                          # Single source of truth (Chrome MV3, Vanilla JS)
│   ├── manifest.json             # (removed — moved to platforms/chrome)
│   ├── background.js             # Service worker: context menus, alarms, notifications, side panel
│   ├── content.js                # Content script: page text extraction, highlighting, hybrid sidebar
│   ├── popup.html                # Popup UI (header → screens → bottom-nav)
│   ├── popup.js                  # Popup entry point — wires up all module inits
│   ├── styles.css                # Global styles (glassmorphism, light/dark themes)
│   ├── api.js                    # API helpers
│   ├── services.json             # Provider registry (OpenAI, Mistral, Deepseek, Ollama, …)
│   ├── prompts.json              # Preset prompt library
│   ├── compatible-tools.json     # Compatible tools table (generated from readme)
│   ├── translations.json         # UI translation strings (source of truth)
│   ├── donationMessages.json     # Donation message pool
│   ├── privacy.md                # Privacy policy
│   ├── readme.md                 # Extension-specific readme
│   ├── _locales/                 # i18n messages per locale (ar, de, en, es, fr, hi, it, ja, ko, pt_PT, ru, zh_*)
│   ├── icons/                    # Extension icons (16/48/128 + svg)
│   ├── lib/                      # Vendored libs (e.g. d3.min.js)
│   └── modules/                  # ES modules (see table below)
│
├── platforms/                    # Per-platform manifests
│   ├── chrome/manifest.json      # Chrome: sidePanel + service_worker
│   ├── android/manifest.json     # Android: no sidePanel, service_worker
│   ├── firefox/manifest.json     # Firefox: gecko id, background.scripts (event page)
│   └── ios/manifest.json         # Safari/iOS: background.scripts
│
├── scripts/
│   └── build.js                  # Node dev-sync tool (src → dev/<platform>)
│
├── build.sh                      # Release build: version bump + zip into prod/
├── current_version.json          # Single source of truth for version + language list
├── package.json                  # npm scripts (build, build:chrome, build:firefox, …)
│
├── dev/                          # Generated unpacked builds (git-ignored)
│   ├── aish-extension-chrome/
│   ├── aish-extension-android/
│   └── aish-extension-firefox/
│
├── prod/                         # Generated release zips (git-ignored)
│   ├── aish-extension-chrome-<ver>.zip
│   ├── aish-extension-android-<ver>.zip
│   └── aish-extension-firefox-<ver>.zip
│
├── bookmarklet-generator/        # Standalone bookmarklet generator (works on iOS)
│   ├── index.html
│   ├── main.js
│   └── styles.css
│
├── blog/                         # Marketing blog (static HTML + blogPosts.json)
├── lang/                         # Website translations (generated by translate.py)
├── assets/                       # Marketing images (aish.png, createBookmarklet.svg, …)
├── chrome-extension_LEGACY/      # Archived legacy extension (reference only)
│
├── .github/workflows/
│   ├── release.yml               # Tag-triggered: build + version bump + GitHub release
│   └── translate.yml             # Auto-translates translations.json → lang/
│
├── translate.py                  # OpenAI-powered translation script
├── index.html / script.js / style.css   # Root marketing website
├── sitemap.xml                   # SEO sitemap
└── table.txt                     # Compatible-tools table (intermediate build artifact)
```

### `src/modules/` — ES module responsibilities

| Module | Responsibility |
| --- | --- |
| `uiManager.js` | Screen navigation (main/history/apps/settings), bottom-nav blob, `showScreen()` |
| `storageManager.js` | Storage abstraction (sync/local), services config, migration, `updateService()` |
| `extensionApi.js` | Cross-browser `browser`/`chrome` namespace wrapper |
| `mainScreen.js` | Main screen chat feed, streaming bubbles, onboarding/empty state |
| `settingsManager.js` | Settings screen logic, model config, bookmarklet generator, Save button |
| `authManager.js` | byphil Cloud OTP auth flow (request/verify code, token storage) |
| `modelManager.js` | Service/model config + model identifier tag UI |
| `promptManager.js` | Prompt dropdown + custom prompt logic |
| `languageManager.js` | Language dropdown + persistence |
| `articleManager.js` | Article rendering, expand/collapse, search, detail view |
| `archiveManager.js` | Archive/history UI and logic for saved articles |
| `archiveGraph.js` | D3.js knowledge-graph visualization of article tags |
| `analyticsManager.js` | Reading analytics / report view (heatmap, streaks, model stats) |
| `audioManager.js` | Podcast audio generation and saving |
| `podcastManager.js` | Podcast feature (beta) |
| `localSendClient.js` | LocalSend handshake + file upload over LAN |
| `toolsManager.js` | Compatible tools loading/display |
| `shortcuts.js` | Keyboard shortcuts (e.g. Cmd+F) |
| `accordion.js` | Accordion UI behavior |
| `i18n.js` | Translation loader (applies `data-i18n` attributes) |

### Build pipeline

- **Dev sync** — `node scripts/build.js` (or `npm run build`) copies `src/` into `dev/aish-extension-<platform>/` and overlays the matching `platforms/<platform>/manifest.json`.
- **Release** — `./build.sh` bumps the version in `current_version.json` + all `platforms/*/manifest.json` + `src/popup.html`, then zips each platform build into `prod/`.
- **CI** — `.github/workflows/release.yml` runs `build.sh` on tag push, commits the version bump, and creates a GitHub release with the three zips.

### Cross-browser notes

- `src/` is written against the `chrome.*` namespace. A tiny shim at the top of `content.js`, `background.js`, and `popup.js` aliases `chrome → browser` when only `browser.*` exists (Safari/iOS), so the same code runs on every platform.
- Firefox uses `background.scripts` (event page) + a `gecko.id`; Chrome uses `service_worker` + `sidePanel`; Android/iOS omit `sidePanel`.

## Installation and Usage

### Chrome Extension

1. Navigate to the `src` directory and follow the instructions in the `readme.md`.

### Firefox Extension

1. Run `npm run build:firefox` (or `node scripts/build.js firefox`) to sync `src/` into `dist/firefox/` with the Firefox manifest.
2. Open `about:debugging#/runtime/this-firefox` in Firefox and click **Load Temporary Add-on**, then select `dist/firefox/manifest.json`.

### Safari (iOS / macOS)

1. Run `npm run build:ios` (or `node scripts/build.js ios`) to sync `src/` into `dist/ios/`.
2. Convert the WebExtension into a native container app:
   ```bash
   xcrun safari-web-extension-converter ./dev/aish-extension-ios \
   --project-location dist/ios \
   --app-name "AI Summary Helper" \
   --bundle-identifier "eu.byphil.aisummaryhelper" \
   --copy-resources \
   --force
      

   ```
3. In Xcode, ensure the extension target bundle ID starts with the parent app's bundle ID (e.g. `eu.byphil.aisummaryhelper.extension`), select the same signing team for both targets, and run on a concrete device/simulator (not "Any iOS Device").

### Bookmarklet Generator

1. Navigate to the `bookmarklet-generator` directory and follow the instructions in the `readme.md`.


## Feature Agenda 🚀

Bookmarklet generator generally ships faster since it is faster to iterate on.

### Browser Plugin

- [x] Summarize page via popup or keyboard shortcut
- [x] Custom prompt per request + saved default prompt
- [x] Multi-language summary output
- [x] Summary length slider
- [x] Article history with search and graph visualization
- [x] Text highlighting (yellow / AI ghost highlights) with per-page persistence
- [x] Enable/disable highlighting toggle in settings
- [x] Context menu: Highlight selection, Remove all highlights, Summarize page, Summarize & close tab
- [x] **Save for Later** — right-click any tab → "Summarize & Close": generates summary, saves with timeframe reminder (tomorrow / weekend / week / research session), closes the tab, shows in history with metadata
- [x] **RSVP Speed-reading overlay** — while summarizing on close, the AI output streams word-by-word as a speed-reading display; adjustable speed (slow/medium/fast) saved between sessions
- [x] **Timed reminders** — Chrome notifications remind you to revisit saved articles at your chosen timeframe
- [x] Backup & Restore (v2 format: settings + full article history)
- [x] Inline mode ("Send to Kindle" friendly)
- [x] Native side panel support
- [x] Graph view of article archive (D3.js, keyword-based)
- [x] **Analytics Report** — reading activity heatmap, top topics, streaks, model usage stats, per-article or full-archive view
- [x] Multi-provider support: OpenAI, Mistral, Deepseek, Ollama, byphil Cloud (no API key needed)

### Bookmarklet Generator 
- [x] Save API Key in Browser
- [x] iOS compatibility 
- [x] Select dom element by clicking to make insertion-point be definable by user
- [x] Add status state
- [x] Support other providers (on-device? What are some local LLMs we could use for this / API through localhost?)
    - [x] Ollama
- [ ] Include update mechanism (make the bookmarklet check this repo for a newer script) 


## Privacy Policy

The privacy policy for this project is available in the [Privacy section](/src/privacy.md).

## License

2024 Phil Wornath - [MIT License](LICENSE)

## Troubleshooting

### Configuring CORS for Ollama (The "Failed to Fetch" Error)

It looks like you've hit the classic CORS (Cross-Origin Resource Sharing) wall. Even though the configuration is correct, the browser blocks requests from websites (like arxiv.org) to your local Ollama instance for security reasons because Ollama isn't explicitly saying "I allow requests from this website."

Since the extension's content script runs directly on the page, its "Origin" is the website you are visiting, and Ollama rejects it by default.

To fix this, you need to set the `OLLAMA_ORIGINS` environment variable. Here is the breakdown based on your operating system:

#### 1. Windows (Most Common Issue)

1. Quit Ollama entirely. Look for the Ollama icon in your System Tray (bottom right, near the clock), right-click it, and select **Quit**.
2. Open the Start Menu, search for "Edit the system environment variables," and open it.
3. Click **Environment Variables**.
4. Under User variables, click **New**:
   - Variable name: `OLLAMA_ORIGINS`
   - Variable value: `*`
5. Click **OK** on all windows.
6. **Crucial:** Open a new Terminal or Command Prompt and type `ollama serve` (or simply relaunch the Ollama app from the Start menu).

#### 2. MacOS

1. Quit Ollama from the Menu Bar icon.
2. Open Terminal and run:
   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   ```
3. Restart the Ollama application.

*Note: To make this permanent, you usually need to add that line to your `~/.zshrc` or `~/.bash_profile`.*

#### 3. Linux (Systemd)

If you are running Ollama as a service:

1. Run `sudo systemctl edit ollama.service`.
2. Add these lines under the `[Service]` section:
   ```ini
   [Service]
   Environment="OLLAMA_ORIGINS=*"
   ```
3. Save and exit, then run:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ollama
   ```

🧐 **Why is this happening?**
Browsers follow a "Same-Origin Policy." When the extension tries to fetch `localhost:11434`, the browser sends a "Preflight" request (an `OPTIONS` check) to see if the server allows it. If `OLLAMA_ORIGINS` isn't set, Ollama doesn't include the `Access-Control-Allow-Origin` header in its response, and the browser kills the request. Setting it to `*` tells Ollama to accept requests from any origin.

#### Use Ollama via HTTPS (Advanced)

If you are running Ollama on a remote server behind an HTTPS proxy (like Nginx, Apache, or Cloudflare), you normally **do not** need to set `OLLAMA_ORIGINS` on the server itself. Instead, ensure your proxy is configured to allow CORS headers:

- **Why?** Browsers block "Mixed Content" (requesting HTTP from an HTTPS site). Using an HTTPS endpoint for Ollama solves this.
- **How?** Add `Access-Control-Allow-Origin: *` to your proxy configuration settings.

For more detailed guidance, refer to the comprehensive guide on handling CORS settings in Ollama [here](https://medium.com/dcoderai/how-to-handle-cors-settings-in-ollama-a-comprehensive-guide-ee2a5a1beef0).



# Compatible Tools
<!-- table with tools, name, description, url -->
Tools that are compatible with AI Summary Helper.
Feel free to add your own tool to the list.

Name | Description | URL
--- | --- | ---
Reabble Send to Kindle | Send your summarized articles to Kindle. | https://send.reabble.com/
Web Clipper | Clip your summarized web pages to different places (e.g. OneNote, Notion, GitHub etc.) | https://clipper.website/
Inoreader | RSS Feed Reader | https://www.inoreader.com/

