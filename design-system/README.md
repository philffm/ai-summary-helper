# Design system: tokens

One token source for the extension (popup, side panel, reader) and the website, in every brand (AISH today, Koru as the
rebrand candidate) and every theme. Git is the truth; Figma mirrors it. Everything under `dist/` and every
`/* @tokens:start … */` region in a stylesheet is generated, never edited by hand.

```
npm run tokens          # write the stylesheet regions + dist/ (Figma, Android, resolved JSON)
npm run tokens:check    # CI gate (also runs in .github/workflows/ci.yml)
npm run tokens:report   # the gate plus every contrast ratio
npm run build -- --koru # extension in another brand: its regions are regenerated from the brand's tokens
```

## Tiers

| Tier | Where | Holds | Read by |
|---|---|---|---|
| **Primitive** | `tokens/primitive/color.json` (brand-neutral), `tokens/primitive/brand/<brand>.json` (one file per brand: accent ramp, highlight ramp, tinted surfaces, glows, fonts) | literal values only | semantic and component tokens |
| **Semantic** | `tokens/<context>/<mode>.json` → `"semantic"` | what a value is for: `text-primary`, `accent`, `on-accent`, `ok`, `elevation-2` … | component tokens and component CSS |
| **Component** | `tokens/<context>/base.json` → `"component"` | one component's roles, each **an alias of one semantic token** (`--sheet-bg: var(--surface-sheet)`), defined once, no theme of its own | that component's CSS |

Contexts: `app` (extension) and `site` (website). Modes: `app/base` (theme-independent), `app/light`, `app/dark`,
`app/dark-forced` (the three values that differ when dark is picked in Settings instead of following the OS), `app/contrast`;
`site/base`, `site/dark` (the site's default), `site/light`, plus the scoped component sets `site/mock/*` (hero mock) and
`site/photo/*` (photo stage). `config.json` says which sets go into which selector and region.

The website also exposes its primitive palette as variables (`--gray-990`, `--brand-accent-400` …) so its role blocks stay
readable; components never read them (`scripts/tests/css-tokens.test.mjs` and the gate both check).

### Component tokens are aliases

Themes live in the semantic tier only. A component token is defined once (in `<context>/base.json`) and references a
semantic (or another component) token, so switching the theme or the brand never touches the component layer. Two
explicit, gate-checked exceptions:
- `fixed` (with a reason): the same value in every theme and brand, e.g. a third-party mark (`--localsend-bg`), media overlays,
  the feature-tile illustrations. It may read a primitive.
- `scene`: the website's hero mock and photo stage (`site/mock/*`, `site/photo/*`) are pictures with their own small palette,
  scoped to their element.

### Names show the tier (no `sem-` / `comp-` abbreviations)

- **Component** tokens start with their component: `--player-bg`, `--sheet-grab`, `--switch-knob`, `--saved-note-user-bg`,
  `--chart-3`, `--mock-accent` (or `--on-<component>-…` for content on it). The JSON group is the component; the gate checks the prefix.
- **Semantic** tokens start with a role or category: `--text-*`, `--accent*`, `--on-accent`, `--ok`, `--danger`,
  `--elevation-*`, `--bg*`, `--surface-*`, `--border-*`, `--glass-*`, `--tone-*`, `--fs-*`, `--radius-*`.
- **Primitives** are not emitted in the extension; the website's palette names say what they are (`--gray-990`,
  `--brand-accent-400`) and the test keeps them out of component rules.
- In Figma the tier is the first path segment (`semantic/text/text-primary`, `component/player/player-bg`), in JSON the
  second (`app.semantic.text.text-primary`).

### Rules the gate enforces

- A primitive holds a literal; it never references anything.
- A semantic token never reads a component token. A semantic or component colour is always a reference (`{brand.accent.600}`,
  `{app.semantic.text.text-primary}`), never a pasted value.
- Component CSS (everything outside the regions) has **no colour literal** (`#…`, `rgb()`, `hsl()`; `#000` in a mask is coverage
  and allowed), **no primitive** and **no token that is defined nowhere** (`config.json › runtimeTokens` lists the ones set by script).
- Every text/background pair in `config.json › contrast` reaches WCAG 2.2 AA in **every brand × theme**.
- The regions and `dist/` are up to date.

## Format

DTCG (`$value`, `$type`, `$description`, `{path}` references). Two project extensions under `$extensions["eu.byphil.ds"]`:
- `alpha`: the referenced colour at an opacity. In CSS a reference to another context token becomes
  `color-mix(in srgb, var(--x) 8%, transparent)` (stays live per theme), a primitive becomes `rgba()`.
- `template: true`: a composite CSS value (shadow, gradient, `color-mix` of two colours) with `{path}` / `{path@0.2}` inside.
  Use it only where DTCG has no type for the value.

Colours are written as CSS colour strings (`#2563eb`, `hsl(…)`) rather than the 2025.10 object form, so the files stay
hand-editable; the generator parses both.

A context token's CSS name is its last key: `{app.semantic.text.text-primary}` → `--text-primary`. The names are the ones the
code already used, so 4,700 lines of extension CSS did not have to change. Renaming them to the full grammar
(`color.text.primary` → `--color-text-primary`) is a later, separate step with a codemod (see `adr/0003`).

## Add or change a token

1. Pick the tier. A new colour first becomes a primitive (or a brand step), then a semantic token, then (only if one
   component needs its own role) a component token that references the semantic one.
2. Write the light value in `<context>/light.json` (or `base.json` if it is the same in every theme), the dark value in
   `<context>/dark.json`. Description required for anything not obvious from the name.
3. `npm run tokens`, read the diff of the stylesheet region, `npm run tokens:check`.
4. Use it in CSS as `var(--name)`.

## Add a brand

1. Copy `tokens/primitive/brand/aish.json` to `<id>.json` and change the values (accent ramp 50–950, highlight ramp, the two
   tinted surfaces, the two glows, fonts). Keep the step names: semantic tokens point at them.
2. `npm run tokens:report`: every pair must pass AA. Adjust steps until it does.
3. `brands/<id>.json` keeps the non-visual parts (name, host, icons, manifest) and the hex map for colour literals outside the
   stylesheets (JS, SVG, HTML).
4. `npm run build -- --<id>` / `npm run site:brand -- --<id>`.

Koru's 50–700 steps and surfaces come from the Brand exploration (Oct 2026); the in-between steps, `950`, the highlight ramp,
glows and fonts are derived proposals, listed in the file's `provisional` note.

## Figma (Figma Professional, no Variables REST API)

`dist/figma.json` is the mirror, applied with the Figma MCP / a plugin script (Plugin API), which works on the Professional
plan. Collections, in the order a value flows:

| Collection | Modes | Holds |
|---|---|---|
| Primitive | Value | raw palette (hidden from pickers) |
| Brand | AISH, Koru | brand ramps; alpha variants Figma cannot alias are derived `alpha/…` variables |
| Semantic · App / Semantic · Site | Light, Dark | roles, aliasing Brand/Primitive |
| Component · App / Component · Site | Value | aliases of Semantic only |

Every variable carries its CSS name as WEB code syntax. A frame picks the theme on the Semantic collection and the brand on
Brand. Direction is one-way, code → Figma: a value changed in Figma goes back into the JSON by a pull request.

## Motion and breakpoints

`--duration-*` and `--easing-*` (semantic, both contexts) drive every transition under 600 ms; `reduced-motion.json` sets the
durations to 0.01ms for `prefers-reduced-motion` and the app's own Reduce motion setting. Breakpoints are `--bp-*` tokens; CSS
media queries cannot read them, so `lint.mjs` keeps every query width on the scale and JS reads them via
`plugin/src/modules/breakpoints.js`. ADR 0005.

## Components

`components.json` is the component manifest source: one entry per Figma Library v3 component with its purpose, CSS selectors,
source files, Figma node, variants, properties, accessibility notes and do/don't. `components.mjs` (part of `npm run tokens`)
adds the tokens each component reads, taken from the CSS rules of its selectors, and writes `dist/components.json` and
`dist/components.md` (one section per component, for people and AI tools). `npm run tokens:check` fails when a selector has no
CSS rule, a source file is missing, a semantic token has no `$description`, or the generated files are stale. Figma links each
component to its manifest entry with Code Connect (label Markdown, source `design-system/dist/components.md`). ADR 0005.

## Android

`dist/android/DesignTokens.kt` holds the app colours per brand × theme as Compose `Color`s. The Android app does not read it
yet (`mobile/android/…/Theme.kt` still has its own palette); switching it over is a follow-up.

## Decisions

See `adr/`.
