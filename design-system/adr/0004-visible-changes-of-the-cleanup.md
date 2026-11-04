# ADR 0004: Visible changes accepted during the token cleanup

Status: accepted · 2026-11-04

All token values that existed are byte-for-byte or numerically identical after generation (checked: 282 extension values,
344 website values). These component-level changes are deliberate:

| Where | Before | After | Why |
|---|---|---|---|
| 14 buttons/chips with `background: var(--accent)` | `color: #fff` | `var(--on-accent)` | white on the dark-theme accent `#60a5fa` is 2.5:1 |
| `.btn-link` | `var(--primary)` (undefined → inherited text colour) | `var(--text-link)` | the role it was written for |
| `--success` / `--warning` reads (8) | undefined, six different fallbacks | `--ok` / `--warn` | one success and one warning colour |
| `--border`, `--border-color`, `--card-bg`, `--surface-2` reads | undefined, grey fallbacks | `--outline`, `--glass-input`, `--neutral-tint` mix | defined roles |
| 16 one-off box shadows | 12 different values | `--elevation-1…4`, `--elevation-up`, `--sheet-shadow` | a scale |
| "different page" note | always light yellow (also in dark) | `--caution-*`, dark-aware | readable in dark theme |
| feed badge, savings | emerald `#10b981` / `#22c55e` | `--ok-bright` | one bright success green |
| mood segments | own HSL values | `--mood-pos/neg/warn` | same as the rest of the mood UI |
| dark-theme OS + Contrast theme | dark tokens leaked into Contrast | dark media block excludes Contrast | Contrast is a light theme |
| website hero mock accent tints | fixed blues | mixes of the brand accent (Δ ≤ 3/255, two edges ≤ 14/255) | the mock follows the brand (Koru) |
| nav blob, dark theme chosen in Settings | `#93c5fd` with dark text, unlike the OS-dark gradient | same gradient as OS dark | one component token, no theme of its own |
| Contrast theme: slider fill, note text | AISH blue | the Contrast theme's accent | they read `--accent` / `--text-link` now |

