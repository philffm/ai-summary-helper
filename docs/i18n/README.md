# AI Summary Helper website — i18n / translation pipeline

The site ships as plain static HTML per locale (GitHub Pages serves `docs/`
directly) — no client-side rendering, nothing here changes how a crawler or
answer engine sees the site. Two build steps run before deploy; both output
plain files.

## Architecture

**Hand-edited source lives in `site-src/`, not `docs/`.** `docs/` is a
generated + committed output directory (committed because GitHub Pages
needs real files to serve, same reasoning as before):

- `site-src/partials/` — shared fragments (`nav-home.html`, `nav-blog.html`,
  `footer-home.html`, `footer-blog.html`) used via `<!--include:name-->`
  markers. Edit the nav once here, not once per page.
- `site-src/pages/` — the actual page templates (English), each with a
  `{{base}}` token standing in for the "how many `../` do I need to reach
  the shared `assets/` folder" — resolved per-page based on its depth.
- **`scripts/build-site.mjs`** — assembles `site-src/` → `docs/*.html`
  (English). Run this first, always, before translating.
- **`scripts/translate.mjs`** — translates `docs/*.html` → `docs/lang/{locale}/*.html`.

## How translation staleness works

1. **`docs/i18n/locales.json`** — source of truth for which files get
   translated, into which languages, plus per-locale market-adaptation
   notes (tone, what to emphasize — not just literal translation).
2. **`docs/i18n/manifest.json`** — auto-generated cache, keyed **per string**
   (sha256 of the English text), not per file. Each entry holds the
   translated text per locale. A string is stale only when its own English
   text changes — not when *anything else on the page* changes.
   - This also means identical strings are translated once and reused
     everywhere: the nav text lives in one partial, appears on every page,
     and costs one translation call per locale, not one per page.
   - Rebuilding the output HTML itself (`translate.mjs`'s write step) is
     always cheap and always happens — only the *API call* is skipped on a
     cache hit. So a structural change to a page (new markup, reordered
     sections) always flows through even if no string text changed.
3. **`scripts/translate.mjs`** — extracts strings with cheerio (body text,
   `<title>`, meta description, `og:title`/`og:description`, `alt` text),
   looks each one up in the string cache per locale, sends only the misses
   to OpenRouter in one batched request per (file, locale), reinjects the
   full set (cache hits + fresh) into a clone of the DOM, rewrites `assets/`
   paths for the extra locale-directory depth, adds `hreflang` tags, and
   writes to `{locale.dir}/{originalPath}`.

## Running it

```bash
npm install
npm run site:build            # assemble docs/ from site-src/ — do this first, always
node scripts/translate.mjs --dry-run          # no API calls, mock output — safe to run anytime
node scripts/translate.mjs                    # real run, needs OPENROUTER_API_KEY
node scripts/translate.mjs --locale=fr        # just one locale
node scripts/translate.mjs --file=index.html  # just one source file (path relative to docs/)

# or, both steps together:
npm run translate:dry-run
npm run translate
```

## GitHub Actions

`.github/workflows/translate.yml` runs on any push to `main` touching
`site-src/**` or `docs/i18n/locales.json`. It runs `build-site.mjs` then
`translate.mjs`, and **opens a pull request** rather than committing
directly — machine translation and market adaptation should get a human
read-through before going live, at least until you've built up trust in a
given locale's output quality.

### One-time setup

1. In the repo's **Settings → Secrets and variables → Actions**, add a
   secret named `OPENROUTER_API_KEY` with your OpenRouter key.
2. That's it — the workflow already has `contents: write` and
   `pull-requests: write` permissions to open the PR.

### Adding a new locale

Add an entry to `i18n/locales.json` under `locales`, then run:

```bash
node scripts/translate.mjs --locale=<new-code>
```

or trigger the workflow manually (Actions tab → "Translate & localize
website content" → "Run workflow") with the locale code in the input box.

### Cost note

Every push that touches content triggers a full re-check, but only *stale*
(file, locale) pairs actually call the API — untouched ones are skipped
(you'll see `skip ... — up to date` in the log). A typical single-page edit
costs one API call per affected locale, not a full-site re-translation.
