# Notes for coding agents

## Styling: design tokens
- Colours, shadows, radii and font sizes come from tokens. Source: `design-system/tokens/*.json` (DTCG), read `design-system/README.md` first.
- Never edit a `/* @tokens:start … */ … /* @tokens:end … */` region in `plugin/src/styles.css` or `docs/assets/styles.css`,
  nor `design-system/dist/`: change the JSON, run `npm run tokens`.
- In component CSS use `var(--semantic-or-component-token)`. No `#hex`, `rgb()`, `hsl()`; no palette variables
  (`--gray-*`, `--brand-accent-*`); no new `var(--x, fallback)` for a token that does not exist. For an alpha, use
  `color-mix(in srgb, var(--token) N%, transparent)`.
- Component tokens are named after their component (`--player-bg`, `--saved-note-user-bg`), semantic tokens after a role (`--text-muted`, `--elevation-2`); no tier abbreviations.
- A new colour goes primitive → semantic (→ component only if one component needs its own role), with light and dark values.
- Brand (AISH, Koru) is a token file, never a condition in CSS or JS.
- Focus: use `outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset)` (`--focus-ring-inset` inside clipped containers); never `outline: none` on `:focus-visible` without a ring. Error and delete text use `--danger-text`, not `--danger`.
- Motion: `transition`/`animation` durations under 600 ms use `var(--duration-*)`, curves `var(--easing-*)`; they drop to 0.01ms when motion is reduced. Breakpoints: media/container widths must be a `--bp-*` value (lint), JS uses `bp('split')` from `modules/breakpoints.js`.
- Every new semantic token gets a `$description` (what it is for, not its value).
- UI components: look them up in `design-system/dist/components.md` (purpose, selectors, states, tokens, a11y) before building a new one; a new or changed component gets an entry in `design-system/components.json`.
- Before finishing: `npm run tokens:check` (tier rules, token-clean CSS, WCAG AA for every brand × theme, component manifest).
