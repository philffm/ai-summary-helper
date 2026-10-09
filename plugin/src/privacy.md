# Privacy Policy

**AI Summary Helper**

<!-- Generated from site-src/pages/privacy.html by scripts/privacy-md.mjs. Edit the HTML, not this file. -->

_Last updated: October 2026_

This Privacy Policy explains what data AI Summary Helper handles, where it goes, and why. The short version: your API keys, your article history, and your highlights stay on your device. Page content is only ever sent to the AI provider you choose to connect — including, if you choose it, a fully local model where nothing leaves your machine at all. We do not run ads, do not sell data, and do not require an account for any core feature.

If you disagree with any part of this policy, please do not install or use the extension.

## No Account Required for Core Features

AI Summary Helper does not require you to create an account, sign in, or provide any personal information to summarize pages, highlight, follow feeds, or keep your archive. Your API key (if you use your own) and your entire article history live in your browser's local storage.

An account is only needed for the hosted services: byphil Cloud (summaries without your own key) and Send to Kindle. Signing in works with your email address and a one-time code. We store that email address, your plan or license status and basic usage counters (for example the number of requests and Kindle sends) so we can apply plan limits.

## What Data We Handle, and Where It Goes

### Your AI provider connection

You choose how summaries are generated:

- **Bring your own key (BYOK)** — OpenAI, Google Gemini, Mistral AI, DeepSeek, or a custom endpoint. Your API key is stored locally on your device only (never synced, never sent to us). Page content you choose to summarize is sent directly from your browser to the provider you selected, using your own key and subject to that provider's own privacy policy. We do not see, log, or store this content.
- **Local model via Ollama** — if you run a model locally, page content is sent only to your own machine. Nothing leaves your device.
- **byphil Cloud (optional, paid)** — a hosted option for people who'd rather not manage an API key. If you choose this tier, page content is sent to our backend, which proxies the request to an underlying model provider on your behalf and returns the summary. We do not permanently store the content of pages processed this way.

### License and subscription status

If you activate a Pro license or byphil Cloud subscription, your license key is stored locally on your device (never synced) and used to verify subscription status with our backend. Basic account/billing metadata is handled by our payment processor and backend; we do not store your page content or reading history on our servers.

### Uninstall feedback

When you uninstall the extension, Chrome opens a short feedback page on this website. The address contains only the extension version and the number of days it was installed — no identifiers, no page content, no history. Anything you type into the form (a reason, a comment, an optional email if you want a reply) is sent to our survey tool, Formbricks, and is only used to improve the extension. You can close the page without answering.

### Article history, highlights, and settings

Everything you save is stored locally in your browser, using Chrome's built-in storage APIs — never on our servers:

| Data | Storage | Synced via Chrome? |
| --- | --- | --- |
| Saved articles & summaries | Local | No |
| RSS feed subscriptions & items | Local | No |
| API keys / provider config | Local | No — sensitive, device-only |
| License key | Local | No — sensitive, device-only |
| LocalSend network IP | Local | No |
| Text highlights & AI ghost highlights | Local (per page) | No |
| Default prompt, language, summary length | Sync | Yes, via your own Chrome account |
| Highlighting on/off preference | Sync | Yes, via your own Chrome account |

Items marked "Sync" use Chrome's own built-in sync tied to your Google account — this data passes through Google's infrastructure, not ours, exactly like your bookmarks would. We have no separate access to it.

You can export your data at any time via Settings → Library & Data → Backup & restore. In the same place, the Danger zone lets you delete, by category and with a count of what will go: summaries and archive, highlights, feeds, podcasts, API keys / sign-in / license, send targets (Kindle, LocalSend) and preferences. _Delete all data_ removes everything the extension stores on the device and starts it fresh. Removing the extension also removes its data. These actions delete local data only: your account and subscription records on our server (see below) are not affected, so to have those deleted, contact us.

### RSS feeds

The built-in Feeds reader stores your subscriptions and the fetched feed items locally in your browser — never synced, never sent to us. When you add or refresh a feed, the extension requests that feed's address directly from the publisher's server, just like your browser would when visiting the site, so the publisher can see the request. We do not proxy, log, or see your subscriptions or reading list. OPML import is processed entirely on your device. If you turn on background checks (off by default), the extension re-requests your feeds on the interval you choose, only to show a count on the toolbar icon. Summarizing a feed item works like summarizing any other page: its content is only sent to the AI provider you chose, and only when you trigger a summary. The optional AI day recap and AI tone scoring work the same way: only when you click them, the extension sends item titles, source names and short snippets (not full articles) to the AI provider you chose, and the resulting recap is cached on your device. Podcast episodes in a feed are streamed directly from the publisher's server when you press Play.

### Sending articles: Kindle, LocalSend, and the share sheet

There are two different paths, and only one of them touches our server:

- **Send to Kindle goes through our server.** Amazon only accepts documents by email from approved senders, so the extension sends the article (title, summary, text, highlights and source address) to the byphil backend, which emails it to the Kindle address you entered. You add our sender address (kindle@byphil.eu) to your approved senders list in your Amazon account. The content is used only to create and send that email. Kindle delivery requires being signed in or having a license; the free tier includes 3 sends.
- **LocalSend and the system share sheet (for example AirDrop) are direct.** The file goes from your browser straight to the device you picked on your local network, or to the app you chose in the share sheet. We are not involved and do not see or store this content. LocalSend works with phones, tablets, computers and e-readers that run a compatible app.

## Analytics & cookies

**Short version:** this website sets **no cookies** and uses no advertising or cross-site trackers. We count anonymous visits with a self-hosted Matomo instance, and you can switch that off at any time.

**The browser extension itself contains no analytics, telemetry or tracking code.** Its only network requests go to the AI provider you configured, the feeds you subscribed to, the pages you ask it to fetch, and (if you use them) the byphil backend for byphil Cloud, sign-in, license checks and Send to Kindle.

### What we measure

Page views, the page language, referrer, approximate country/browser/device class, and which parts of the site you interact with (for example clicks on "Add to Chrome", the pricing toggle, FAQ items, sections you scroll to, and steps of the bookmarklet generator). Events never contain e-mail addresses, API keys, one-time codes, page content or article data.

### How it is configured

Matomo runs on our own server (analytics.philwornath.de, Germany), not at a third party. It is loaded with cookies disabled and without browser-feature fingerprinting; IP addresses are anonymised before storage; no user ID or cross-site identifier is assigned, so visits cannot be linked across days or devices. Data is not sold or shared with third parties.

Because nothing is stored on or read from your device for tracking purposes, this measurement is based on our legitimate interest in understanding how the site is used (Art. 6(1)(f) GDPR) and does not require a cookie consent banner under § 25 TDDDG / the ePrivacy Directive. You have the right to object (Art. 21 GDPR) at any time.

### Your choices

Analytics is switched off automatically if your browser sends _Do Not Track_ or _Global Privacy Control_. You can also opt out manually via Analytics settings (also in the footer of every page).

### What is stored in your browser

Only functional preferences, never for tracking: `aish_analytics` (your opt-out choice), `aish_analytics_notice` (that you dismissed the info notice), and, if used, the theme choice, the language-suggestion dismissal and the bookmarklet generator settings. These stay on your device and are not sent to us.

### Fonts & external resources

Fonts (Inter, Space Grotesk, JetBrains Mono; SIL Open Font License) are served from this site itself, so your IP address is not passed to Google or any font provider just by visiting. The only external requests are links you click, and the optional byPhil account / Stripe checkout pages you choose to open.

## Permissions We Request, and Why

| Permission | Why we need it |
| --- | --- |
| `activeTab` | Read the content of the page you actively choose to summarize |
| `storage` | Save your settings, article history, and highlights locally |
| `contextMenus` | Provide right-click actions (Summarize, Highlight, etc.) |
| `notifications` | Show timed reminders for articles you've saved for later |
| `alarms` | Schedule those reminder notifications |
| `tabs` | Close the tab automatically after "Summarize & Close" |
| `sidePanel` | Support Chrome's native side panel as a viewing option |
| `scripting` | Inject the content script needed to read and summarize a page |
| `offscreen`, `tts` | Play podcast audio and read summaries aloud in the background while the popup is closed |
| `unlimitedStorage` | Keep a large local archive of articles and highlights without hitting the default storage quota |
| `host_permissions (<all_urls>)` | Let you summarize any page you visit — content is only read and transmitted when you actively trigger a summary, never passively |

We do not use these permissions to track your browsing, build an advertising profile, or collect data beyond providing the features described above.

## What We Don't Do

- We don't run or serve ads, and we don't sell, rent, or trade your data to advertisers or data brokers.
- We don't require an account or sign-in for any core feature.
- We don't log or retain the content of pages you summarize via your own API key or a local model, and we never see what you send over LocalSend or the share sheet.
- We don't have access to your locally stored article history, highlights, or API keys — they never leave your device unless you explicitly export them.

## Third-Party Services

Depending on how you configure the extension, your page content may be sent to:

- OpenAI, Google (Gemini), Mistral AI, or DeepSeek — only if you've entered your own API key for that provider, and only for the page you actively summarize.
- Our byphil backend — only if you use byphil Cloud or Send to Kindle.
- Amazon — if you send an article to your Kindle, Amazon delivers it under its own privacy terms.
- Your own local Ollama instance — not a third party; stays on your machine.

We are not responsible for the privacy practices of third-party AI providers you choose to connect. We encourage you to review their policies before connecting an account.

## Data Security

We use reasonable technical measures appropriate to the data involved — most of which never reaches our servers in the first place, since it's stored locally in your browser. Communication with our backend (for byphil Cloud and license verification) is encrypted in transit. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security, but we do not collect more than what's needed to provide the described features.

## Children's Privacy

AI Summary Helper is not directed at children under 13 (or the relevant minimum age in your jurisdiction), and we do not knowingly collect personal information from children.

## Your Rights (GDPR / CCPA and similar)

Since almost all of your data is stored locally on your own device, you already have direct control over it — you can view, export, or delete it at any time via the extension's Settings, or by uninstalling the extension. For any data we do hold on our servers (byphil Cloud subscription/billing metadata), you can request access, correction, or deletion by contacting us below.

## Changes to This Policy

We may update this Privacy Policy as the extension's features change. Material changes will be reflected here with an updated "Last updated" date. Continued use of the extension after a change constitutes acceptance of the updated policy.

## Contact Us

Questions about this Privacy Policy? Contact us at [philipp@wornath.de](mailto:philipp@wornath.de), or via [GitHub Issues](https://github.com/philffm/ai-summary-helper/issues).
