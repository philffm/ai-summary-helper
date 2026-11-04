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
- Before finishing: `npm run tokens:check` (tier rules, token-clean CSS, WCAG AA for every brand × theme).
