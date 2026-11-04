# ADR 0001: Tokens live in Git; Figma mirrors them

Status: accepted · 2026-11-04

## Context
Two stylesheets (extension, website) each had their own token blocks, written by hand, with different names, neutrals and
scales. Koru existed only as a hex find-and-replace on build output, which missed the website's own blues, gold and glows.
The Figma file is on the Professional plan: no Variables REST API, no extended collections.

## Decision
- DTCG JSON in `design-system/tokens` is the single source. CSS regions, the Figma mirror and Android colours are generated.
- Figma is a mirror and editor of drafts, not the source. Sync is one-way (code → Figma) through the Plugin API
  (Figma MCP `use_figma`), which works on the Professional plan.
- Brands are token files (`primitive/brand/<id>.json`), not code forks: `npm run build -- --koru` regenerates the regions with
  Koru's primitives; the hex map in `brands/koru.json` remains for literals outside the stylesheets.

## Consequences
- A visual change is a JSON change plus `npm run tokens`, reviewed in the pull request.
- Changes made in Figma have to be carried into the JSON by hand (or by a later import script).
- Moving to Figma Enterprise would allow Variables REST sync; the JSON stays the source either way.
