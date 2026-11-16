// content/markColors.js
// Colours of what AISH paints into the page itself (marks and ::highlight), outside any shadow root: the light values of the
// annotation tokens. AISH does not theme the page, so marks look like a highlighter pen on every page, light or dark.
// design-system/lint.mjs checks that every value equals its token (dist/tokens.resolved.json, app · light, every brand).
export const MK = Object.freeze({
  'annotation-user-bg': '#fef9c3',
  'annotation-user-fg': '#713f12',
  'annotation-user-bar': '#eab308',
  'annotation-ai-bg': '#e0f2fe',
  'annotation-ai-fg': '#0c4a6e',
  'annotation-ai-bar': '#0284C7',
});
