# ADR 0005: Alignment with the multi-brand framework (MPS battle plan, Nov 2026)

Status: accepted · 2026-11-04

## Context
The reference framework "Multi-Brand Design System – Empfohlener Ansatz" (Nov 2026) sets conventions for token tiers, naming,
tooling, quality gates, AI readiness and governance. It is written for a publisher with many brands, platforms and teams. AISH is
one product (extension + website + Android companion), two brands (AISH, Koru as rebrand candidate) and one maintainer. This
record states where we follow it, where we deliberately do less, and what we adopt next.

## Where we already follow it
- **Git is the truth, Figma mirrors it** (ADR 0001): DTCG JSON in `design-system/tokens`, one-way sync to Figma via the Plugin API.
- **Generated files are never edited**: stylesheet regions and `dist/` are written by `build.mjs`; `--check` fails when they drift.
- **Brands differ in tokens only**: `primitive/brand/aish.json` holds 28 tokens (framework guide: 20–40); `npm run build -- --koru`
  regenerates the regions from Koru's primitives.
- **Axes stay orthogonal**: brand and theme are modes (Figma collections Brand: AISH/Koru, Semantic: Light/Dark; contrast theme in CSS),
  context (app/site) is a token set, platform (CSS, Kotlin) is a build output.
- **Tiers**: primitive (incl. brand) → semantic → component; components read only semantic or component tokens (gate-enforced).
- **Quality gate**: WCAG 2.2 AA contrast for 210 pairs × brand × theme, naming rule, no colour literal / primitive / undefined
  token in component CSS, generated files up to date.
- **Decision log**: ADRs plus a `Doc / Decision record` on every ticket page in Figma (question, options with verdict, proposal,
  decision and rationale, trade-offs, as built, evidence, quality gate).
- **Dark mode rules**: system default, manual choice saved, contrast theme.
- **Data tokens**: `data-0..7`, `data-other`, `chart-*` aliases.

## Where we deliberately do less (and when to revisit)
| Framework | Here | Revisit when |
|---|---|---|
| Style Dictionary / Terrazzo | own generator `build.mjs` (ADR 0002) | the Android app reads tokens, or a third platform appears |
| npm packages, pnpm monorepo, Turborepo | one repo, consumers read the regions | a second product consumes the tokens |
| Changesets, independent SemVer | none; the extension version is the only release | packages exist |
| `core › family › brand` | `primitive › brand`, no families | more than three brands |
| Component tokens only where semantics fall short | every component role is an alias (Spectrum style) | never; aliases cost little and give Figma a component collection |
| DTCG 2025.10 colour objects | CSS colour strings (hand-editable), generator reads both | an external tool needs the object form |
| Storybook as component docs | Figma Library v3 descriptions (CSS class, states, A11y) | components are shared beyond the extension |
| RACI, champions, stakeholder map | one maintainer | a second contributor joins |

## What we adopt next (in this order)
1. **Enforce the gate in CI**: add `npm run tokens:check` to `.github/workflows/ci.yml` (cannot be written from the Claude session).
2. **Focus tokens (11.1)**: `focus.ring.width` 2px, `focus.ring.offset` 2px, two-colour ring after technique C40
   (`focus.ring.inner`/`outer`), `layout.scroll-padding.top`/`bottom` for the fixed header and bottom nav (WCAG 2.4.11).
   Same change: error text, Danger outline buttons and Delete read `--danger-text` (``--danger`` is 3.52:1 on dark cards).
   **Done 2026-11-04:** semantic `focus-ring`, `focus-ring-width` (2px; 3px and text-primary in the contrast theme),
   `focus-ring-offset` (2px) and `focus-ring-inset` (-2px, for menus, toolbars and rows inside clipped containers); all 29
   component focus rules and the global `:where(…):focus-visible` rule read them; six controls that only tinted on focus now
   show the ring; `.screen` and `.feed-scroll` get `scroll-padding` for the fixed header, bottom nav and composer. The second
   ring colour of C40 is the page colour in the 2px offset gap, so no extra halo token was needed. `danger-text` in light is
   red 700 (6.3:1 on cards, ≥ 5.5:1 on every sticky); 12 text uses of `--danger` moved to it. The gate now also checks
   `danger-text` on cards, sheets and stickies and `focus-ring` (3:1) on page, cards and sheets: 264 pairs AA.
3. **AI readiness to "structured"**: Code Connect for the ~25 Library v3 components; a generated component manifest
   (name, status, purpose, variants, props, a11y, tokens, do/don't) from the Figma descriptions and the CSS; `$description`
   on every semantic token (today 57 of 804 tokens have one).
   **Done 2026-11-04:** `design-system/components.json` (31 components: purpose, selectors, sources, Figma node, variants,
   properties, a11y, do/don't) → `components.mjs` adds the tokens each component reads from the CSS and writes
   `dist/components.json` + `dist/components.md`; part of `npm run tokens` and `tokens:check` (fails on a missing CSS rule or
   source, a semantic token without `$description`, or stale output). All 234 semantic tokens have a description (mirrored to
   the Figma variables). **Code Connect is not available on the Professional plan** ("Code connections can only be made in
   libraries that are in Organization or Enterprise plans"); instead every Library v3 component has a documentation link to its
   manifest section and a `Manifest:` line in its description. Switch to Code Connect (label Markdown or Web Components) if the
   plan changes.
4. **Motion and breakpoint tokens (11.2, 11.5)**: `motion.duration.short|medium|long`, `motion.easing.standard|emphasized`,
   reduced-motion values; `layout.breakpoint.*` for 720 / 1024 / 1100 / 1280 px instead of literals in media queries.
   **Done 2026-11-04:** `--duration-fast|base|slow|slower|screen|reveal` (150/200/300/400/350/500 ms) and
   `--easing-standard|decelerate|accelerate|in-out|emphasized|spring|screen` in both contexts; `app|site/reduced-motion.json`
   sets every duration to 0.01ms under `prefers-reduced-motion: reduce` and `html[data-motion='reduce']`. 166 durations and 121
   easings in the two stylesheets now read them (values rounded to the nearest step: 0.12–0.18 s → 150 ms, 0.2–0.26 s → 200 ms,
   0.28–0.3 s → 300 ms, 0.38–0.45 s → 400 ms, 0.5–0.55 s → 500 ms); loops and ambient motion of 0.6 s and more stay literal.
   Breakpoints are semantic `--bp-*` tokens (app 420/440/480/720/760/780/900/1100, site 420/560/640/720/760/860/900/1024/1280);
   media queries cannot read custom properties, so `design-system/lint.mjs` checks every `@media`/`@container` width against them
   (old website widths 520/600/700/820/960/1180 sit on `config.json › offScaleBreakpoints`, a list that may only shrink) and JS
   reads them through `plugin/src/modules/breakpoints.js` (split view 720/1100, settings 900, article toolbar 440/780).
5. **Naming grammar (ADR 0003 "Later")**: `{category}.{concept}.{property}.{variant}.{state}`, state last, no opacity in names
   (`--accent-a08` → `color.accent.bg.subtle`), emitted with deprecated aliases for one minor and a codemod. Figma variant
   states move to one set: `default`, `hovered`, `pressed`, `focused`, `selected`, `disabled`.
6. **Smaller items**: icon sizes 16/20/24 (today 14/16/20/24), data tokens `data.compare.better|worse` and `data.highlight`,
   readable i18n keys for system microcopy (`error.form.required` instead of hashed keys), `hiddenFromPublishing` for the
   deprecated v2 and the proposed components in Figma.

## Definition of done for a component (from now on)
In code and in Figma Library v3 with Code Connect; states default/hovered/focused/disabled (+selected, error where they apply);
contrast checked by the gate; keyboard and screen reader checked once; in use in the product.
