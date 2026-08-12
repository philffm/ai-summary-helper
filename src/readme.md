# AI Summary Helper — Chrome Extension

A powerful browser extension for summarizing web pages with a custom AI prompt, storing article history, and managing your reading queue.

## Installation

### From Chrome Web Store
[Install from Chrome Web Store](https://chromewebstore.google.com/detail/ai-summary-helper-summari/hldbejcjaedipeegjcinmhejdndchkmb)

### Load Unpacked (Development)
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this `chrome-extension/` folder

## Features

### ✨ Summarization
- Summarize any web page via the popup or keyboard shortcut
- Custom prompt per request, with a saved default prompt
- Adjustable summary length (100–500 words)
- Multi-language output — pick any language for summaries
- **Extension mode** — summary shown in the popup/sidebar  
- **Inline mode** — summary inserted into the page (great for Send-to-Kindle)

### 🔖 Save for Later (Tab Management)
Right-click any page → **Summarize & Close tab**:
1. An in-page dialog asks *why* you're saving and *when* to be reminded (Tomorrow / Weekend / This Week / Research Session)
2. A speed-reading RSVP overlay streams the summary word-by-word while the AI processes
3. The tab closes automatically once you've finished speed-reading
4. The article is saved to history with the timeframe and reason visible on the card
5. A Chrome notification reminds you at the chosen time

### ⚡ Speed Reading Overlay
- Words flash one at a time (RSVP format) while summarizing
- Three speed settings: Slow (300ms), Medium (200ms), Fast (120ms)
- Speed preference is saved between sessions
- Manual "Close Tab" button available at any time
- Tab only auto-closes after reading is complete

### 🖊️ Text Highlighting
- Select text → highlight in yellow (persists across page reloads, per-page)
- AI ghost highlights (light blue) applied automatically from summary keywords
- Right-click → **Highlight selection** or **Remove all highlights**
- Enable/disable highlighting globally in Settings

### 🗂️ Article History
- All saved articles stored locally in your browser
- Search with real-time filtering (also filters the graph view)
- Decision articles show timeframe badge + reason in the list card
- Full article detail view with summary, source link, model info
- Export to Markdown (Obsidian-compatible YAML frontmatter)
- Share, Copy, Kindle, Reader, and Delete actions

### 🕸️ Archive Graph
- D3.js force-directed graph of your article archive
- Keyword-based clustering
- Syncs with search filter — graph updates as you type

### 📊 Analytics Report
- Reading activity heatmap (GitHub-style, by day/week)
- Top topics and keywords from your archive
- Reading streak and total article count
- Summary length distribution
- Most-used AI models
- Available per-article (single article graph) or across your full archive

### 📊 Context Menus
Right-click on any page to access:
- ✏️ Highlight selection
- 🧹 Remove all highlights
- ✨ Summarize this page
- ✨ Summarize & close tab (triggers Save for Later flow)

### 🔔 Timed Reminders
- Chrome alarms fire notifications at your chosen timeframe
- Notification includes article title and your saved reason
- Click "Open" in the notification to reopen the article

### ⚙️ Settings
- **Connection**: byphil Cloud (no API key needed) or direct API (OpenAI, Mistral, Deepseek, Ollama, custom)
- **Model selection**: per-provider model picker with custom model ID support
- **Prompt**: custom default prompt or choose from presets
- **Language**: default summary language
- **Summary length**: default word count
- **Highlighting**: enable/disable globally
- **Side panel**: open as native side panel or injected iframe
- **Backup & Restore**: export/import all settings + full article history (v2 format)

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open popup | Click extension icon |
| Fetch summary | `Ctrl+Shift+S` (configurable) |

## Permissions Used

| Permission | Reason |
|------------|--------|
| `activeTab` | Read page content for summarization |
| `storage` | Save settings, article history, highlights |
| `contextMenus` | Right-click menu actions |
| `notifications` | Timed reminders for saved articles |
| `alarms` | Schedule reminder notifications |
| `tabs` | Close tab after "Summarize & Close" |
| `sidePanel` | Native side panel support |
| `scripting` | Inject content script when needed |

## Architecture

```
popup.html / popup.js        — Main UI (popup + sidebar)
  modules/
    articleManager.js        — History rendering, search, graph toggle
    settingsManager.js       — Settings form, backup/restore
    mainScreen.js            — Fetch button, ping/retry, streaming relay
    modelManager.js          — Provider/model selection
    languageManager.js       — Language picker
    storageManager.js        — chrome.storage abstraction
    uiManager.js             — Screen switching, toasts
    i18n.js                  — UI translations (14 languages)
    archiveGraph.js          — D3.js graph visualization
    ...

content.js                   — Injected into pages
  - fetchSummary()           — Streams AI response, updates UI
  - saveToLocalStorage()     — Persists article to local storage
  - Highlighting system      — Yellow + ghost highlights
  - showDecisionDialog()     — In-page Save for Later dialog
  - createStreamingOverlay() — RSVP speed-reading display
  - Hybrid sidebar           — Injected iframe fallback

background.js                — Service worker
  - Context menus
  - Alarm scheduling (timed reminders)
  - Chrome notification handling
  - Native side panel toggle
  - Stream proxy port (streamFetch)
```

## Storage

| Key | Location | Contents |
|-----|----------|----------|
| `articles` | `local` | Array of saved article objects |
| `servicesConfig` | `sync` | API keys, models per provider |
| `activeService` | `sync` | Currently selected provider |
| `prompt` | `sync` | Default summary prompt |
| `selectedLanguage` | `sync` | Default output language |
| `summaryLength` | `sync` | Default word count |
| `highlightingEnabled` | `sync` | Highlighting on/off |
| `annotations_*` | `local` | Per-page yellow highlights |
| `ghost_annotations_*` | `local` | Per-page AI ghost highlights |

Article objects saved via "Summarize & Close" include additional fields:
- `isDecision: true`
- `decisionTimeframe` — `"tomorrow"` \| `"weekend"` \| `"week"` \| `"research"`
- `decisionReason` — user's note
- `decisionSavedAt` — ISO timestamp

## Development

No build step required — pure ES6 modules loaded directly by Chrome.

To test changes:
1. Edit files
2. Go to `chrome://extensions` → click the reload icon on the extension card
3. Re-open the popup or reload the target page
