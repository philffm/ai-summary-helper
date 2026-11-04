# ADR 0003: Three tiers now, full naming grammar later

Status: accepted · 2026-11-04

## Context
Components must read only semantic or component tokens. The audit (Nov 2026) found 147 colour literals in extension component
rules, 13 tokens read but never defined (their fallbacks were the real, inconsistent values), component token blocks defined
among the components (`--st-*`, `--tp-*`), and colour-named roles on the website (`--gold`, `--glow-sky`, `--icon-cyan-1`).

## Decision
- Tiers: primitive (raw, per brand), semantic (role, themable), component (one component's roles, an alias of a semantic token, no theme of its own; exceptions `fixed` and `scene` are marked in the token). Tier is part of every
  token path; the gate enforces the reading rules.
- Existing CSS names stay (`--text-primary`, `--bg`, `--accent-fill`) so the component CSS did not have to be rewritten;
  colour-named roles were renamed (`--gold*` → `--highlight*`, `--highlight-*` → `--mark-*`, `--icon-<colour>-N` → `--tile-N-from|to`,
  website palette `--blue-*`/`--amber-*` → `--brand-accent-*`/`--brand-highlight-*`).
- Extension and website keep separate semantic vocabularies for now (`--text-primary` vs `--text`, radius-md 12 vs 10).

## Later
1. One semantic vocabulary for both contexts following `{category}.{concept}.{property}.{variant}.{state}`
   (`color.text.primary`, `color.action.primary.bg.hover`), emitted with deprecated aliases for one minor version and a codemod.
2. Converge the two neutral palettes and radius scales (a visible design change, needs a design decision).
