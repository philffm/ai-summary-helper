# Repository Audit (`AUDIT_REPO.md`)

**Project Name:** AI Summary Helper (AISH)

**Date:** 2026-11-03

**Extension Version:** `2.2.40` | **Web Version / SHA:** static site in `docs/` @ `5285298` (`main`)

**Status Verdict:** 🟡 Attention Needed. The codebase is in good shape. Lint and tests pass, the BYOK keys stay on the device, and messages are origin-gated. The pdf.js CVE and the missing Limited Use statement were fixed on 2026-11-03. Still open: gaps in automated security scanning and web hardening, and broad host permissions (low priority).

> **About the template.** The template assumes a pnpm monorepo with `apps/extension`, `apps/web` and `packages/shared`. This repo has a different layout:
>
> | Template workspace | Actual location |
> | --- | --- |
> | `apps/extension` | `plugin/` (source in `plugin/src`, per-browser manifests in `plugin/platforms/{chrome,firefox,android,ios}`, build in `plugin/scripts/build.js`) |
> | `apps/web` | `site-src/` (templates) → `docs/` (generated static site on GitHub Pages, `CNAME` → `ai-summary-helper.byphil.eu`) |
> | `packages/shared` | No real shared package. `shared/` holds only `suggested-feeds.json` and a Gradle file |
> | (not in template) | `mcp/` (local MCP relay, Node, published separately), `mobile/android` (companion APK), `plugin/inbox-api` (OpenAPI + reference server) |
>
> There is no server-side web backend in this repo. The proxied endpoints (`api.byphil.eu`) live elsewhere, so section 3's "API & Backend" and most of section 5 can only be checked from the client side here.

**How this was measured:** a static read of the code at `5285298` plus these commands:

| Check | Result |
| --- | --- |
| `npm ci && npm run lint -- --quiet` | ✅ 0 errors |
| `npm test` (affected-test runner) | ✅ 22/22 passed (207 tests total in suite; full run is `npm run test:release` in CI) |
| `npm audit --omit=dev` | ⚠️ 1 high (`undici`, pulled in by `cheerio`; used only by build scripts, not shipped) |
| Regex secret scan over all 1,579 commits | ✅ No real secrets. 2 expected hits: YouTube's public web-player key in `plugin/src/content/youtube.js:6` and AWS's documented `AKIAIOSFODNN7EXAMPLE` |
| `eval(` / `new Function(` in `plugin/src` (excluding `lib/`) | ✅ none |

---

## 1. Extension Core & Manifest V3 Compliance

* [ ] **Permission Minimization** (partial)
  * ⚠️ (low priority) `host_permissions: ["<all_urls>", "file:///*"]` plus a content script on `<all_urls>` in all four manifests. This drives the CWS "in-depth review" flag and the broad install warning. With `activeTab` + `scripting` already declared, a plain summarize doesn't need it. Background feed fetching, highlight re-drawing and arbitrary custom endpoints do. `optional_host_permissions` would be one prompt when a feature is turned on, not one per page. But highlight re-drawing and feed fetching need broad access anyway, so the gain is mostly a softer install warning. Low priority.
  * ✅ Every Chrome permission has a written justification in `store-listing/chrome-web-store/permission-justifications.md` (`offscreen`, `sidePanel`, `tts`, `tabs`, `scripting`, `storage`/`unlimitedStorage`, …).
  * ✅ No remote code. `script-src 'self'; object-src 'self'` on extension pages. Dynamic `<script>` loads only pull packaged files (`chrome.runtime.getURL('lib/d3.min.js')` in `modules/archiveGraph.js:326`; the `viewer/` export loads sibling files only).
  * ⚠️ `web_accessible_resources` exposes `popup.html`, `modules/*`, `lib/*` to `<all_urls>`. Any site can detect the extension (fingerprinting). The sidebar's iframe channel is token-protected (`modules/sidebarChannel.js`). Consider `use_dynamic_url: true` on Chrome.

* [x] **Service Worker & Runtime Lifecycle**
  * ✅ Listeners are registered at top level in `background.js` (`onInstalled` :285, `onStartup` :1041, `alarms.onAlarm` :1114, `storage.onChanged` :1162, `runtime.onMessage` :1469).
  * ✅ Persistent state lives in `chrome.storage.local` through a key registry (`modules/storageKeys.js`). Jobs are rehydrated (`sumJobsReady()`) rather than held in memory.
  * ✅ Audio runs in an offscreen document created on demand with `AUDIO_PLAYBACK` (`background.js:1538`). DOM parsing happens in content scripts and pages, not in the SW.

* [ ] **Content Script Isolation & Messaging** (partial)
  * ✅ In-page popovers use Shadow DOM (`content/notesPopover.js:41`, `content/highlightPanel.js:70`). The sidebar is an iframe.
  * ⚠️ `content/ui.js` and `highlighter.js` still inject inline-styled nodes into the host DOM (noted as deliberate in `plugin/PROJECT_AUDIT.md`).
  * ✅ `fromExtensionPage(sender)` checks `sender.id === chrome.runtime.id` and the extension URL. `EXTENSION_PAGE_ACTIONS` (`background.js:1461`) blocks content scripts from key-spending and fetch actions.
  * ⚠️ Payloads are checked by hand (`typeof msg.url === 'string'`, `str(…, 300)`), with no schema. A small validator map per `msg.action` would harden the ~60-branch handler. Zod is not needed; a dependency-free checker fits the no-bundler style.

---

## 2. Monorepo Architecture & Code Quality

* [ ] **Workspace Boundaries & Package Contracts** (partial)
  * ⚠️ There are no workspaces. Root `package.json` is tooling only. `mcp/` has its own `package-lock.json`. That is fine for its size, but the root `npm ci` does not cover `mcp/`.
  * ✅ Nothing server-side reaches the extension: `plugin/src` uses no npm runtime deps and vendors `lib/` by hand.
  * ⚠️ Constants are duplicated across surfaces (endpoints, storage keys between `plugin/` and `mobile/`). A real `shared/` contract would only be worth it if the Android app and MCP start to drift.
  * ✅ Lockfiles are committed (`package-lock.json`, `mcp/package-lock.json`). CI uses `npm ci`.

* [ ] **Build Targets & Asset Segregation** (partial)
  * ✅ `plugin/scripts/build.js` builds per platform (`chrome|firefox|android|ios`). `docs/` is a separate artifact. No secrets are needed to build.
  * ❌ No dead-code tool (`knip` or similar) runs. Module size is the long-standing open item from `PROJECT_AUDIT.md` (`feedManager.js` 2,788 lines, `background.js` 2,033 lines).
  * ✅ The Firefox manifest is hand-maintained with `browser_specific_settings.gecko`, `data_collection_permissions` and a `background.scripts` fallback. It works without `webextension-polyfill`.
  * ⚠️ The repo weighs 387 MB in `.git` and 337 MB in `docs/`. Blog MP4s run up to 14 MB each in Git. Move them to Releases, LFS or a CDN.

* [x] **Test Coverage & Automated Verification**
  * ✅ 207 jsdom tests plus 2 Playwright e2e files (`plugin/tests/e2e/`). On PRs, `ci.yml` runs lint, demo check, sitemap/link tests and affected tests. On `main` and nightly it runs the full release gate and files flaky-test issues.
  * ⚠️ `mcp/` has no tests in CI, and `release.yml` skips tests except on manual runs (it relies on `ci.yml` having passed on `main`).

---

## 3. Security, Privacy & API Credentials

* [ ] **API Keys & Secret Storage** (partial)
  * ✅ `servicesConfig` (API keys and endpoints), license key, tokens, `mcpSecret` and `syncSecrets` are in `LOCAL_KEYS` → `chrome.storage.local`. `migrateSensitiveToLocal()` moves legacy copies out of `storage.sync`. Only preferences use `storage.sync` (language, mood flag, panel dock).
  * ✅ Backup export leaves out `SECRET_KEYS` by default. Including them, or importing a file that contains them, asks for explicit `confirm()` (`settingsManager.js:1378`, `:1461`).
  * ❌ No automated secret scanning in CI. Add `gitleaks` with an allowlist for `content/youtube.js:6`. That key is YouTube's public web-player key, built into every watch page; the code prefers the page's own key and only falls back to it. It isn't a secret, but scanners will flag it.

* [ ] **Content Security Policy & Injection Defense** (partial)
  * ✅ The extension CSP is `'self'` only.
  * ✅ **Fixed 2026-11-03: pdf.js 4.0.379 was vulnerable to CVE-2024-4367** (arbitrary JS via crafted font, fixed upstream in 4.2.67; the extractor renders image pages, so the path was reachable). Now on the minified legacy build of 6.5.438, which removed the eval font path entirely. The modern build was rejected because it uses syntax Safari can't parse. JBIG2/JPEG 2000 decoders ship as plain-JS fallbacks (`useWasm: false`, since the CSP has no `'wasm-unsafe-eval'`). Teardown now uses `loadingTask.destroy()`, because 6.x removed `PDFDocumentProxy.destroy()`. Verified in Chromium under a `script-src 'self'` CSP: text extraction, page rendering, JPEG 2000 decode, invalid-PDF rejection. Size: 2.4 MB → 2.3 MB.
  * ⚠️ 99 `innerHTML =` assignments remain in `plugin/src`. Stored page content goes through `escapeHtml` / `cleanUntrustedHtml` (`textUtils.js`), but nothing enforces it. An ESLint rule (`no-unsanitized`) would lock that in.
  * ⚠️ The site (GitHub Pages) has no CSP. Pages can't send headers, so `frame-ancestors` isn't possible there. A `<meta http-equiv="Content-Security-Policy">` with `script-src 'self' analytics.philwornath.de` is still worth adding.
  * ⚠️ Indirect prompt injection: extracted page text goes straight into prompts. That's normal for the category, but it isn't disclosed in-product or covered by tests.

* [ ] **API & Backend Protection (Web)** (only partly checkable here)
  * ✅ The MCP relay (`mcp/src/relayServer.js`) accepts only extension origins or no-origin local peers, uses constant-time token match and a failure rate guard.
  * ❓ The `api.byphil.eu` proxy (cloud models, Kindle, auth refresh) is outside this repo, so its CORS, rate limits and tenancy couldn't be verified.
  * ⚠️ `npm audit`: `undici` high via `cheerio` (build-time only). Run `npm audit fix` to clear the noise.

---

## 4. UX, Design System & Accessibility

* [ ] **Extension Interface Ergonomics** (partial)
  * ⚠️ `body { min-width: 400px }` with `max-width` commented out (`styles.css:292-295`) and no fixed height. The popup can reflow while content streams in.
  * ✅ 42 `:focus-visible` rules. `modules/a11y.js` exists and there is a carousel a11y test.
  * ✅ Ollama errors are covered: `ollamaCheck.js` returns `unreachable | forbidden | http | invalid` with a 4 s timeout. The 403 case is CORS (`OLLAMA_ORIGINS`) guidance.

* [ ] **Web Platform Experience & Handshake**
  * ❌ The site doesn't detect the extension. CTAs always say "Add to Chrome" (`data-desktop-cta`, `index.html:71`). A content-script-set `data-aish` attribute on the own domain is enough to switch to "Open AISH".
  * ❓ Core Web Vitals weren't measured. Risk: 6 `<img>` with only 4 `loading="lazy"` on the homepage, and large video/photo assets.
  * ❓ Contrast wasn't measured. There are 4 `prefers-color-scheme` blocks in `styles.css`. Run axe/Lighthouse in the existing Playwright setup.

---

## 5. Operations, Infrastructure & Observability

* [ ] **Hosting & Compute Footprint**
  * ✅ The site is static on GitHub Pages, so there's no compute to run. The MCP relay runs locally on the user's machine.
  * ⚠️ `docs/assets` is 301 MB, which bloats clones and every Pages deploy (see 2).
  * ❓ Inference spend on the `api.byphil.eu` cloud tier isn't visible from this repo.

* [ ] **Telemetry & Health Monitoring**
  * ✅ No error telemetry in the extension at all (privacy by design). `log.js` forbids logging keys and article text.
  * ⚠️ The consequence is that SW crashes and unhandled rejections are invisible. If wanted, add an opt-in, PII-free error counter. Don't add Sentry by default, because it would contradict the privacy promise.
  * ❌ No uptime check on `api.byphil.eu` or the site exists in this repo.

---

## 6. Business, Positioning & Store Presence

* [x] **Chrome Web Store Optimization**
  * ✅ The first paragraph of `description.en.txt` states the use (summarize page/PDF/video, BYOK or Ollama, private library). It's localized into 13 store languages.
  * ✅ Current press screenshots are in `assets/press/` (panel, in-page, research dark, split). Check that they match 2.2.x UI before the next listing update.

* [ ] **SWOT & Positioning**
  * **Strengths:** BYOK + local Ollama, no account needed, local-first library, MCP access from Claude Desktop/Cursor, 13+ languages, wide platform reach (Chrome, Firefox, Android, Safari, bookmarklet), real test suite.
  * **Weaknesses:** One maintainer. Wide scope (RSS, podcasts, graph, Kindle, sync, MCP) is growing faster than module boundaries. `<all_urls>` triggers slower CWS reviews. Large monolith modules.
  * **Opportunities:** Chrome built-in AI (Gemini Nano / Summarizer API) as a zero-setup local default. MCP as a moat. Education and research landing pages already exist.
  * **Threats:** CWS policy changes on broad host permissions. Provider price/API changes. Built-in browser summarizers making the basic feature a commodity.
  * **MoSCoW:** Must: secret scanning (pdf.js fix done). Should: optional host permissions, `no-unsanitized`. Could: extension detection on site, opt-in error counter. Won't (now): monorepo/workspaces migration.

* [ ] **Conversion & Feedback Loops**
  * ⚠️ Matomo (self-hosted, cookieless) is on the site, but CWS links carry no UTM or campaign parameters. The landing → install funnel isn't attributable.
  * ✅ Issue templates (bug/feature) exist, and flaky tests are auto-filed. No documented triage of store reviews.

---

## 7. Legal, Compliance & Store Policies

* [ ] **Chrome Web Store Policy Compliance**
  * ✅ A single-purpose statement is written down (`permission-justifications.md`). The feature breadth is the main risk under "Single Purpose" if a reviewer reads it strictly.
  * ✅ Fixed 2026-11-03: the CWS **Limited Use** sentence was added to `site-src/pages/privacy.html`, and its copies (`docs/privacy.html`, `privacy.md`, `plugin/src/privacy.md`) were regenerated. Locale pages follow via the translate workflow.
  * ✅ The Firefox `data_collection_permissions` are declared as `required: none` with optional categories.

* [x] **Privacy & Regulatory Governance (GDPR / DSGVO)**
  * ✅ The privacy policy has a single source (`site-src/pages/privacy.html` → `privacy.md`, `plugin/src/privacy.md`, checked by tests) and names the GDPR controller. The Impressum is linked in every footer (`byphil.eu/terms.html#impressum`).
  * ✅ The extension has no behavioural telemetry. Site analytics are cookieless and respect DNT/GPC with an opt-out. They are disclosed in the privacy policy.

* [x] **Intellectual Property & Licensing**
  * ✅ AGPL-3.0 `LICENSE` plus `COMMERCIAL-LICENSE.md` (dual license). `LICENSE-MIT` covers releases up to 2.2.38, as stated in the readme.
  * ⚠️ `mcp/package.json` still declares `"license": "MIT"`. Check whether `aish-mcp` is meant to stay MIT or move to AGPL with the rest.
  * ✅ `plugin/src/lib/THIRD_PARTY_LICENSES.md` covers pdf.js (Apache-2.0), D3 (ISC), Lucide (ISC), AFINN (Apache-2.0) and qrcode-generator (MIT). They're vendored by hand, so `npm audit` can't see them. Since 2026-11-03, `scripts/check-vendored-libs.mjs` checks the table against the files on every PR, and against npm releases and advisories nightly, keeping one issue up to date.

---

## Audit Execution Matrix

| Domain | Score (1–5) | Key Blocker / Observation | Immediate Remediation | Assigned Workspace | Target Date |
| --- | --- | --- | --- | --- | --- |
| **1. Extension MV3** | 4 | WAR exposed to all sites; `<all_urls>` (low priority) | `use_dynamic_url` on WAR (Chrome); optional host permissions only if store reviews become a problem | `plugin/platforms/*` | 2026-12-15 |
| **2. Monorepo / Code** | 3 | No dead-code check; 2k+ line modules; 300 MB of media in Git | Add `knip` to CI; move blog MP4s out of `docs/` | root, `plugin/src` | 2027-01-31 |
| **3. Security & BYOK** | 4 | No secret scan; 99 `innerHTML` (pdf.js CVE fixed 2026-11-03) | `gitleaks` job with YouTube-key allowlist; `eslint-plugin-no-unsanitized` | `plugin/src`, `.github` | 2026-11-10 |
| **4. UX / Accessibility** | 4 | No extension detection on site; popup width not bounded; CWV/contrast unmeasured | Add `data-aish` handshake; Lighthouse + axe run in Playwright | Both | 2026-12-31 |
| **5. Ops / Infra** | 3 | No uptime check for `api.byphil.eu`; extension errors invisible | External uptime monitor; optional opt-in error counter | `docs/` + backend (external) | 2027-01-31 |
| **6. Business & Store** | 4 | Install funnel not attributable | UTM/`mtm_campaign` on CWS links; quarterly review triage | Store Listing / Web | 2026-12-15 |
| **7. Legal & Policies** | 4 | `mcp/` still declares MIT (Limited Use added 2026-11-03) | Confirm the `aish-mcp` license | `site-src/pages/privacy.html`, `plugin/src/lib` | 2026-11-17 |
