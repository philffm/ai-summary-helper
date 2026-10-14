# Chrome Web Store listing

Store texts per market, SEO- and GEO-optimized (Oct 2026, based on 2.2.13). Facts checked against the code.

| Market | Title (≤ 75) | Summary (≤ 132) | Description (≤ 16,000) |
| --- | --- | --- | --- |
| en | 70 | 132 | 12635 |
| de | 67 | 126 | 13908 |
| ja | 44 | 75 | 5967 |
| fr | 63 | 124 | 12777 |
| es | 61 | 122 | 12003 |

- **Title and summary** ship with the package: `extensionName` and `extensionDescription` in `plugin/src/_locales/<lang>/messages.json` (already set for en, de, ja, fr, es).
- **Descriptions** are pasted per language in the Developer Dashboard (Store listing → language). Copy `description.<lang>.txt` as is.
- When a feature changes, update the matching section in every language. Shortcut, language counts and provider list appear in several places.
- The byphil Cloud and Kindle limits are enforced server-side; the texts say "small free daily allowance" and "3 sends". Keep them in sync with the server.
