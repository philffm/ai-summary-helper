# AI Summary Helper website — i18n / translation pipeline

The site itself stays plain HTML/CSS/JS with zero build step. This pipeline
is CI-only tooling — it never runs in a browser, never runs at deploy time,
and doesn't change how the site is served.

## How it works

1. **`i18n/locales.json`** — the source of truth for which files get
   translated and into which languages, plus market-adaptation notes per
   locale (tone, what to emphasize, what to avoid — not just "translate
   literally").
2. **`i18n/manifest.json`** — auto-generated. For every source file, records
   a sha256 of its current content, and for every locale, the hash it was
   *last translated against*. A locale is stale whenever those two hashes
   disagree. This is the "keeps track of every file/version" piece — on top
   of git's own history on these files (`git log i18n/manifest.json` shows
   every translation run over time; `git log fr/index.html` shows every
   change to the French page specifically).
3. **`scripts/translate.mjs`** — the pipeline itself:
   - Extracts translatable strings (body text, `<title>`, meta description,
     `og:title`/`og:description`, `alt` text) with cheerio, skipping
     `<script>`/`<style>` and anything under `data-no-translate`.
   - Sends them to OpenRouter in one batched request per (file, locale),
     with the market-adaptation notes from `locales.json` in the system
     prompt — so this is translation *and* localization, not just literal
     conversion.
   - Reinjects the result into a clone of the original DOM, rewrites the
     one class of path that needs it (`assets/` references get an extra
     `../` since the file now lives one directory level deeper — internal
     content links between pages need no change), adds `hreflang`
     alternate tags, and writes the file to `{locale}/{originalPath}`.
   - Updates the manifest.

## Running it

```bash
npm install
node scripts/translate.mjs --dry-run          # no API calls, mock output — safe to run anytime
node scripts/translate.mjs                    # real run, needs OPENROUTER_API_KEY
node scripts/translate.mjs --locale=fr        # just one locale
node scripts/translate.mjs --file=index.html  # just one source file
```

## GitHub Actions

`.github/workflows/translate.yml` runs the pipeline automatically whenever
`index.html`, any `blog/*.html`, or `i18n/locales.json` changes on `main`.
It **opens a pull request** rather than committing directly — machine
translation and market adaptation should get a human read-through before
going live, at least until you've built up trust in a given locale's
output quality.

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
