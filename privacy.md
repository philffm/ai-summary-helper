# Privacy Policy

**AI Summary Helper** — a Chrome extension by byphil

_Last updated: August 2026_

## Introduction

This Privacy Policy explains what data AI Summary Helper handles, where it goes, and why. The short version: your API keys, your article history, and your highlights stay on your device. Page content is only ever sent to the AI provider *you* choose to connect — including, if you choose it, a fully local model where nothing leaves your machine at all. We do not run ads, do not sell data, and do not require an account for any core feature.

If you disagree with any part of this policy, please do not install or use the extension.

## No Account Required

AI Summary Helper does not require you to create an account, sign in, or provide any personal information to use its core features. Your API key (if you use your own) and your entire article history live in your browser's local storage.

## What Data We Handle, and Where It Goes

### Your AI provider connection
You choose how summaries are generated:
- **Bring your own key (BYOK)** — OpenAI, Google Gemini, Mistral AI, DeepSeek, or a custom endpoint. Your API key is stored **locally on your device only** (`servicesConfig`, local storage — never synced, never sent to us). Page content you choose to summarize is sent directly from your browser to the provider you selected, using your own key and subject to that provider's own privacy policy and data-handling terms. We do not see, log, or store this content.
- **Local model via Ollama** — if you run a model locally, page content is sent only to your own machine. Nothing leaves your device.
- **byphil Cloud (optional, paid)** — a hosted option for people who'd rather not manage an API key. If you choose this tier, page content is sent to our backend (`api.byphil.eu`), which proxies the request to an underlying model provider on your behalf and returns the summary. We do not permanently store the content of pages processed this way — it is used only to generate your summary and is not retained, logged for training, or shared with third parties beyond what's necessary to generate the response.

### License and subscription status
If you activate a Pro license or byphil Cloud subscription, your license key is stored locally on your device (`licenseKey`, local storage — never synced) and used to verify subscription status with `api.byphil.eu`. Basic account/billing metadata (e.g. subscription status) is handled by our payment processor and backend; we do not store your page content or reading history on our servers.

### Article history, highlights, and settings
Everything you save is stored **locally in your browser**, using Chrome's built-in storage APIs — never on our servers:

| Data | Storage | Synced across your devices via Chrome? |
|---|---|---|
| Saved articles & summaries | Local | No |
| API keys / provider config | Local | No — sensitive, kept device-only |
| License key | Local | No — sensitive, kept device-only |
| LocalSend network IP | Local | No |
| Text highlights & AI ghost highlights | Local (per page) | No |
| Default prompt, language, summary length | Sync | Yes, via your own Chrome account (Google's sync, not ours) |
| Highlighting on/off preference | Sync | Yes, via your own Chrome account |

Items marked "Sync" use Chrome's own built-in sync feature tied to your Google account — this data passes through Google's infrastructure, not ours, exactly like your bookmarks or browser settings would. We have no separate access to it.

You can export or delete your full local history at any time via Settings → Backup & Restore, or by removing the extension.

### Kindle, AirDrop, and LocalSend
When you send an article to Kindle, AirDrop, or a LocalSend-compatible device, the formatted file is sent directly from your browser to the destination you chose (your Kindle's email address, a nearby Apple device, or a device on your local network). We do not act as an intermediary and do not see or store this content.

## Analytics

We use Matomo, a privacy-respecting, GDPR-compliant analytics platform, to understand aggregate, anonymous usage patterns (e.g. which features are used) so we can improve the extension. Matomo does not track you individually across sites, does not use cookies for cross-site tracking, and does not sell data. No page content, API keys, or article data is ever included in analytics events.

## Permissions We Request, and Why

| Permission | Why we need it |
|---|---|
| `activeTab` | Read the content of the page you actively choose to summarize |
| `storage` | Save your settings, article history, and highlights locally |
| `contextMenus` | Provide right-click actions (Summarize, Highlight, etc.) |
| `notifications` | Show timed reminders for articles you've saved for later |
| `alarms` | Schedule those reminder notifications |
| `tabs` | Close the tab automatically after "Summarize & Close" |
| `sidePanel` | Support Chrome's native side panel as a viewing option |
| `scripting` | Inject the content script needed to read and summarize a page |
| `host_permissions (<all_urls>)` | Let you summarize any page you visit, on any site — this is required for the extension to work on arbitrary pages, but content is only read and transmitted when you actively trigger a summary, never passively |

We do not use these permissions to track your browsing, build an advertising profile, or collect data for any purpose beyond providing the features described above.

## What We Don't Do

- We don't run or serve ads, and we don't sell, rent, or trade your data to advertisers or data brokers.
- We don't require an account or sign-in for any core feature.
- We don't log or retain the content of pages you summarize via your own API key or a local model — that traffic goes directly from your browser to the provider you chose.
- We don't have access to your locally stored article history, highlights, or API keys — they never leave your device unless you explicitly export them yourself.

## Third-Party Services

Depending on how you configure the extension, your page content may be sent to:
- OpenAI, Google (Gemini), Mistral AI, or DeepSeek — only if you've entered your own API key for that provider, and only for the page you actively summarize. Each is subject to that provider's own privacy policy.
- `api.byphil.eu` (byphil Cloud) — only if you've opted into that tier.
- Your own local Ollama instance — not a third party; stays on your machine.

We are not responsible for the privacy practices of third-party AI providers you choose to connect. We encourage you to review their policies before connecting an account.

## Data Security

We use reasonable technical measures appropriate to the data involved — most of which never reaches our servers in the first place, since it's stored locally in your browser. Communication with `api.byphil.eu` (for byphil Cloud and license verification) is encrypted in transit. No method of transmission or storage is 100% secure, and we cannot guarantee absolute security, but we do not collect more than what's needed to provide the described features.

## Children's Privacy

AI Summary Helper is not directed at children under 13 (or the relevant minimum age in your jurisdiction), and we do not knowingly collect personal information from children.

## Your Rights (GDPR / CCPA and similar)

Since almost all of your data is stored locally on your own device, you already have direct control over it — you can view, export, or delete it at any time via the extension's Settings, or by uninstalling the extension. For any data we do hold on our servers (byphil Cloud subscription/billing metadata), you can request access, correction, or deletion by contacting us below.

## Changes to This Policy

We may update this Privacy Policy as the extension's features change. Material changes will be reflected here with an updated "Last updated" date. Continued use of the extension after a change constitutes acceptance of the updated policy.

## Contact

Questions about this policy or your data:
- GitHub: [github.com/philffm/ai-summary-helper/issues](https://github.com/philffm/ai-summary-helper/issues)
- Website: [ai-summary-helper.byphil.eu](https://ai-summary-helper.byphil.eu)