# Chrome Web Store listing

Store texts per market, SEO- and GEO-optimized (Oct 2026, based on 2.2.13). Facts checked against the code.

| Market | Title (≤ 75) | Summary (≤ 132) | Description (≤ 16,000) |
| --- | --- | --- | --- |
| en | AI Summary Helper – Summarize Web Pages & PDFs (BYOK, Ollama) (61) | 132 | 12608 |
| de | AI Summary Helper – Webseiten & PDFs mit KI zusammenfassen (58) | 126 | 13857 |
| ja | AI Summary Helper – WebページとPDFをAIで要約 (36) | 75 | 5902 |
| fr | AI Summary Helper – Résumer pages web et PDF avec l'IA (54) | 124 | 12874 |
| es | AI Summary Helper – Resumir páginas web y PDF con IA (52) | 122 | 12027 |

- **Title and summary** ship with the package: `extensionName` and `extensionDescription` in `plugin/src/_locales/<lang>/messages.json` (set for en, de, ja, fr, es).
- **Descriptions** are pasted per language in the Developer Dashboard (Store listing → language). Copy `description.<lang>.txt` as is.

## Rules these texts follow

- **No "YouTube" in the title.** YouTube's branding guidelines forbid the name in an app's name; saying the app works with YouTube is fine, so it appears in the summary and description only.
- **Brand names at most 5 times per description** (Ollama, Kindle, YouTube, Chrome, each AI provider), and lists of brands or sites at most 5 entries. The Chrome Web Store spam policy asks for under 5 repetitions per keyword and flags more for extra review: https://developer.chrome.com/docs/webstore/spam-faq/
- "Summarize" is the core term; vary it (key points, overview, short version) rather than repeating it.
- When a feature changes, update the matching section in every language. Shortcut, language counts and provider list appear in several places.
- The byphil Cloud and Kindle limits are enforced server-side; the texts say "small free daily allowance" and "3 sends". Keep them in sync with the server.
