# AISH style audit (2026-10-07)

Scope: `plugin/src/styles.css` (3188 lines, one file), `popup.html` (99 inline `style=""`). Script: measured, not guessed.

## Numbers
- 523 classes defined, 67 never referenced in HTML/JS (some are built dynamically, e.g. `feed-mood-*`; verify before deleting).
- 25 selectors defined twice; 5 of them silently conflict (below).
- 8 `!important` (4 are `[hidden]`/opacity, 4 fight the global `button`/`input` rules inside `.feed-player` and `.feed-tag-x`).
- 114 hardcoded colour uses outside the theme blocks (58 unique). Top: `#fff` x19, `rgba(59,130,246,…)` x30 across 8 alphas (= `--accent` at different opacity, not tokenised).
- 20 distinct `border-radius` literals alongside 5 radius tokens (12px x14, 10px x12, 8/6/4/3/2px, 20px sheets).
- 22 distinct font sizes (12/13/11/14/10 cover 85%; 12.5, 11.5, 10.5, 0.85rem, 9, 8px are strays).
- Only 3 media queries (no narrow-width handling; History search placeholder truncates at 520px).

## A. Real conflicts (same selector, different values, last one wins)
1. `.status-badge` defined twice: 10px/700/glass-input vs 11px/500/tone-read. Second silently overrides the first.
2. `.feed-btn`: min-height 32 vs 30, padding 6/5.
3. `.feed-tag-chip`: indigo tinted chip (11.5px) vs normal chip (13px, glass-input). Two different components share a name; the later wins, so one design is dead.
4. `.feed-toolbar` gap 6 vs 8; `.feed-actions` wrap vs nowrap.
5. `.tabbar-ind` and `.nav-blob` split across two blocks (harmless but confusing).

## B. Parallel components that should be one
| Concept | Variants today | Proposal |
|---|---|---|
| Primary button | `.button-primary` (12/16, 16px) , `.primary-btn` (12/16, r8, 14px), `.feed-btn`+primary | one `.button-primary` + size modifier |
| Secondary button | `.button-secondary` (36px), `.button-icon` (36px), `.action-btn` (44px), `.ps-btn`, `.review-btn`, `.tag-btn` | `.button-secondary` + `.action-btn` sizes (md 44, sm 36); retire `.ps-btn/.review-btn/.tertiary-btn/.primary-btn` |
| Pill / chip | `.chip`(r12, 10px font), `.feed-chip`(r999, 12px, min-h 30), `.tag-btn`(11px), `.ps-chip`, `.feed-tag-chip` x2, `.tag-chip`, `.bubble-tag`, `.model-id-tag`, `.chip-panel-badge` | `.pill` base (+ `.pill--tag`, `.pill--toggle`); badges (`.status-badge`, `.feed-badge`, `.type-badge`) as `.badge` |
| Bottom sheet | `.feed-sheet` (own tokens, fallback #fff), `.sendsheet-panel` (sheet tokens), `.chip-panel` (popover, other shadow) | one `.sheet` using the `--sheet-*` tokens |
| Segmented control | `.sendsheet-seg`, `.ps-seg`, `.feed-mood-seg`, `.ar-view-btn` | one `.seg` (tabs already unified in `tabbar.js`) |
| Card | `.explanatory-card`, `.input-card`, `.feed-set-card`, `.feed-recapcard`, `.feed-option-card`, `.review-card`, `.ar-stat-card`, `.feed-mt-card` (paddings 10/12/14/16/20, radii 10/12/14/lg/xl) | `.card` + `--sm/--md` padding; radius from tokens only |
| Top bars | `#historyTopBar`, `#detailTopBar`, `#feedControls` (just made full-bleed via override block at end of file), `.sel-bar` | one `.topbar` class; delete the older card-style rules the override now masks |
| Icon-button search clear / graph-scope toggle | inline styles in `popup.html` (24px button, pill toggle) | classes |

## C. Token gaps
- Missing tokens: `--accent-a08/10/12/15/30` (accent at opacity) – replace the 30 `rgba(59,130,246,…)`; `--on-media` for the white-on-dark player (`rgba(255,255,255,.06/.12/.18/.22)`); `--danger-light` (`#e24646`).
- `#fff` x19: split into `--on-accent` (exists) vs `--surface-solid`; `.feed-sheet` uses `var(--glass-base-solid, var(--bg-page, #fff))` – a three-level fallback means the token may not exist.
- Radius scale: collapse to `--radius-xs 6 / sm 8 / md 12 / lg 16 / xl 20 / full`; map 3/4/2px to xs (bars/handles) and 10/14px to md.
- Type scale: `--fs-xs 11 / sm 12 / md 13 / base 14 / lg 16 / xl 18 / 20`. Strays 8, 9, 10.5, 11.5, 12.5, 0.85rem go to the nearest step.
- z-index: 14 values (1…1100) with no scale; sticky bars 25, header 100, nav 101–102, sheets 240–300, toasts 1000+. Define `--z-bar/-header/-nav/-sheet/-toast`.

## D. Structure / hygiene
- 67 unused classes incl. whole utility sets (`m-*`, `p-*`, `ml-*`, `gap-*`) and dead History card styles (`history-card*`, `play-button`, `delete-button`). Safe delete after a dynamic-name check.
- 99 inline styles in `popup.html` (38 `display`, 22 `font-size`, 22 `color`, 17 `margin-top`); most should be `.hidden`/stack/spacing utilities or component classes. 3 contain colour literals (`#889999`, `rgba(0,0,0,.2)`) that don't follow the theme.
- `button`/`input` global rules force the `!important` hacks in `.feed-player`/`.feed-tag-x`; scope the globals (`button:not([class])` or reset layer) instead.
- Single 3k-line file with sections appended at the end (Prompts, Review, Tabbar, Full-bleed) overriding earlier rules. Split by layer: `tokens.css`, `base.css`, `components/*.css`, `screens/*.css` (simple `@import`-free concatenation in build, or multiple `<link>`s).
- Responsive: only `min-width:481px`; add 360px handling (History search hint, 4-button top bars).

## E. Suggested order (low risk first)
1. Fix the 5 real conflicts (A) – pick the intended value, delete the loser. Visual diff only where intended.
2. Add missing tokens (C) + z-index/radius/font-size scales; mechanical replace.
3. Delete verified-dead CSS (D).
4. Merge components in order: buttons → pills/badges → sheets → cards → segmented/top bars. After each: jsdom tests + screenshot of Feed, History, Settings, send sheet, light + dark.
5. Inline styles → classes; split the file.
6. Optional: Figma component set that mirrors `.button/.pill/.badge/.sheet/.card/.topbar/.tabbar` so design and code share names.
