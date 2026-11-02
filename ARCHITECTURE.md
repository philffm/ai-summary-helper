# Site architecture and localization

This document describes how the public site is authored, assembled, localized and
validated. The important distinction is between **source templates**, the
**generated English site**, and **generated locale mirrors**.

## 1. Repository layout

```text
site-src/
  pages/                  Hand-edited English page templates
  partials/               Shared navigation and footer fragments
  site.json               Product/site metadata

scripts/
  build-site.mjs          Assemble pages and expand shared includes
  translate.mjs           Translate stale English pages into locale folders
  seo.mjs                 Generate sitemap, metadata and video indexes
  check-sitemap.mjs       Validate links, URLs and hreflang reciprocity
  check-translations.mjs  Validate locale coverage and structure
  lib/
    localized-paths.mjs   Locale paths and internal-link rewriting
    translation-coverage.mjs

docs/
  *.html                  Generated English pages
  <locale>/*.html         Generated localized pages
  assets/                 Shared static assets
  i18n/
    locales.json          Translation inventory and market guidance
    manifest.json         Source hashes and translation audit data
```

`site-src/` is the editing source. Generated HTML in `docs/` is a build
artifact and should not be hand-edited.

## 2. Page assembly

The site is assembled in two conceptual layers.

### Shared site chrome

Navigation and footer markup lives once in
[`site-src/partials/`](/Users/phil/dev/ai-summary-helper/site-src/partials).
Pages include them with markers such as:

```html
<!--include:nav-home-->
<!--include:footer-home-->
```

`build-site.mjs` calculates the relative `{{base}}` path for each page before
expanding those partials. This keeps asset and internal links correct for both
root pages and nested pages such as `blog/` or `rss-news/`.

### Shared sections with audience filtering

The homepage contains the source-of-truth sections for features and FAQs.
Landing pages reference filtered copies:

```html
<!--include:what-it-does:feeds-->
<!--include:evidence:feeds-->
<!--include:landing-demo:feeds-->
<!--include:faq:feeds-->
<!--include:related:rss-->
```

The suffix is a page persona, not a locale. Current personas are:

| Persona | Typical pages | Purpose |
|---|---|---|
| `researcher` | PDFs, research papers | Paper structure, source checking, limitations |
| `feeds` | RSS/news, video reading | Current sources, feeds, timestamps and briefings |
| `hoarder` | Obsidian, knowledge graph | Retrieval, archive, tags and revisiting |
| `privacy` | Local AI | Model/provider boundaries and local storage |
| `mcp` | MCP | Explicit scope, provenance and tool boundaries |

`build-site.mjs` owns the filtering and evidence copy. A page template should
declare the persona and not duplicate the shared section manually.

The landing demo is also persona-specific. It passes a URL contract to the
real demo, for example:

- RSS: `screen=feeds`
- research papers: `scenario=paper&screen=history`
- MCP: `scenario=mcp&panel=mcp`
- local AI: `panel=models`
- archive/Obsidian: `screen=history`

The cloud-sync feature is reachable through the real demo's
`screen=settings&panel=sync&flow=sync-add` flow. That opens **Sync & backup**
and then the **Add a place** chooser for Nextcloud/WebDAV, S3-compatible
storage or a local folder.

## 3. Build order

For normal site work:

```text
site-src + partials
        |
        v
scripts/build-site.mjs
        |
        v
docs/ English pages
        |
        +--> scripts/translate.mjs --> docs/<locale>/
        |
        +--> scripts/seo.mjs -------> sitemap and indexes
```

The recommended complete validation path is:

```bash
npm run demo:check
npm run site:build
node scripts/check-translations.mjs
```

`site:build` runs the privacy generation, page assembly, SEO generation and
sitemap validation. The demo is built separately because it is assembled from
the extension source and published under `/demo/`.

## 4. Localization workflow

Localization is content-change tracked rather than copied blindly.

1. Edit the English source in `site-src/`.
2. Run `npm run site:build`. This produces the canonical English pages in
   `docs/`.
3. `translate.mjs` reads the page inventory from
   [`docs/i18n/locales.json`](/Users/phil/dev/ai-summary-helper/docs/i18n/locales.json).
4. For every configured content page and locale, it hashes the complete
   generated English source.
5. A locale page is stale when its manifest hash does not match that source
   hash.
6. Stale pages are extracted as translation units (title, metadata, text,
   alt text and selected accessible attributes), translated in one batched
   request per locale, and reinjected into a DOM clone.
7. The translated page is written to the locale directory, for example:
   `docs/de/rss-news/index.html`.
8. Internal content links remain inside the mirrored locale tree. Shared
   assets remain in `docs/assets/`, so the localization step adjusts their
   relative paths.
9. `hreflang` links and the translation manifest are updated for auditability.

The manifest records the source hash, translation timestamp and model used.
This means a source edit invalidates only the affected page/locale pair rather
than forcing a complete retranslation.

### Translation inventory

`locales.json` has four responsibilities:

- `content`: pages that are expected to have translations
- `exempt`: deliberately native or non-machine-translated pages
- `stagedTranslationPages`: pages allowed to roll out progressively
- `locales`: locale directories, hreflang values and market-specific writing
  guidance

Staging is intentional. A newly added English landing page can be built and
published before every locale has been translated. It must still be added to
`content` and `stagedTranslationPages` so the rollout is explicit and
validation does not mistake the temporary gap for an accidental missing page.

### Translation boundaries

The translator skips `script`, `style`, `noscript` and elements marked
`data-no-translate`. This protects code, URLs, structured data and deliberately
fixed technical content. Visible UI strings and accessibility labels should
remain in translatable HTML attributes where possible.

Market notes in `locales.json` are part of the translation contract. They
define register, regional terminology and claims to avoid; they are not a
replacement for checking product facts.

## 5. Adding a new landing page

1. Add the English source under `site-src/pages/<slug>/index.html`.
2. Add the page to `content` and, during rollout, to
   `stagedTranslationPages` in `docs/i18n/locales.json`.
3. Choose or add a persona-specific feature, evidence, demo and FAQ mapping.
4. Add related reading in `RELATED_READING` in `scripts/build-site.mjs`.
5. Run the site build and inspect the generated English page.
6. Run translation for the desired locale priority.
7. Run sitemap and translation checks.
8. Check the generated page in a browser, including its demo URL and language
   links.

## 6. Important rules

- Never edit generated `docs/*.html` to fix a source problem.
- Keep claims in evidence slides narrower than the cited research.
- Treat citations as routes back to evidence, not proof that an AI answer is
  correct.
- Keep local processing, provider requests and optional encrypted sync as
  separate data boundaries in copy and demos.
- When a demo feature changes, update the demo URL contract and run
  `npm run demo:check`.
