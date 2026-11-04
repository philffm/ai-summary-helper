# ADR 0002: A small dependency-free generator instead of Style Dictionary

Status: accepted · 2026-11-04

## Context
The framework this follows recommends Style Dictionary. The repository ships plain CSS with no build step for the site,
tests run on Node only, and the outputs are few (two stylesheets, one Figma JSON, one Kotlin file).

## Decision
`design-system/build.mjs` (one file, Node built-ins only) resolves references, writes marked regions into the existing
stylesheets, exports Figma/Android/resolved JSON and runs the gate (tier rules, token-clean component CSS, WCAG AA per
brand × theme).

## Consequences
- No new dependency, local build well under a second.
- If native apps start consuming tokens in earnest (iOS, Android themes), switch the transform to Style Dictionary or Terrazzo;
  the DTCG source stays as it is. Two non-standard extensions (`alpha`, `template`) would need a small custom transform there.
