# Brands (white-label builds)

The source tree is written in one brand, the default (`aish.json`: "AI Summary Helper" / "AISH"). Any other brand is a
small JSON file next to it, applied to a **finished build output** so the source never forks.

```
npm run build -- --<brand>            # extension, all platforms → plugin/dev/<brand>-extension-<platform>
plugin/build.sh --<brand>             # + zips in plugin/prod/<brand>-extension-<platform>-<version>.zip (no version bump)
npm run site:build && npm run site:brand -- --<brand>   # docs/ → docs-<brand>/ (translated pages included)
node brands/index.mjs list
```
Add `--strict` to fail when the old brand is still visible in the output. The default build (no flag) is byte-identical to before.

## Brand file

`id`, `slug` (artifact prefix), `name` (replaces "AI Summary Helper"), `short` (replaces standalone "AISH"), `siteHost`,
`colors` (hex → hex, plus `rgba(r,g,b` prefixes), `assets` (`extension`/`site`: output path → file in `brands/<id>/`),
`manifest` (JSON merge patch per platform, `all` for every platform), `replace` (extra `[regex, text]` rules),
`provisional` (placeholders; printed as warnings on every build), `needsNewArtwork` (notes, not enforced).

## What is deliberately never rewritten

Translation lookup keys. The UI finds a string by a hash of its English source (`T('Sign in to AI Summary Helper')` →
`f_sign_in_to_ai_summary_helper_<hash>`), so rewriting that literal would drop its translation in every language.
The brand reaches users through the rewritten locale **values**; `T()`/`TN()`/`TU()`/`N_()`/`lbl()` literals are masked in JS.
Also kept: storage keys, `aish-*` classes, `AISH_*` globals, the byphil umbrella brand, `kindle@byphil.eu`, API paths,
GitHub and store URLs.

## Not covered yet

`mobile/android` (applicationId, `strings.xml`, ~20 Kotlin literals, launcher icons, `Theme.kt`) and raster artwork
(`assets/*.png`, `og-share.jpeg`, `extension.png`). Gradle can't be verified from this environment, so Android is left for a follow-up.
