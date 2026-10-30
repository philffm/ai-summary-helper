// modules/mcp/brand.js
// The brand guide AI apps get through aish-mcp (`hello.brand`): short server instructions, plus the full guide served as the
// aish://brand resource and the on_brand prompt. Written in the default brand's name, colours and host, so the white-label
// build (brands/index.mjs) rewrites it like any other source file: a Koru build hands out the Koru guide.

const NAME = 'AI Summary Helper';
const SHORT = 'AISH';
const SITE = 'https://ai-summary-helper.byphil.eu';
const FULL = SHORT === NAME ? NAME : `${NAME} (${SHORT})`;   // a brand whose short name is its name says it once

/** Sent as the MCP server's `instructions`: the app reads them when it connects. Kept short; the details are in aish://brand. */
export const BRAND_INSTRUCTIONS = `When you create something visual or shareable from the user's ${FULL} library (an artifact, HTML page, slide deck, document, chart, diagram or image built from articles, summaries, highlights, collections or feeds this server returned), style it in the ${NAME} brand: read the aish://brand resource (or use the on_brand prompt) for colours, type, shapes and tone. The user's own request wins: if they ask for another style, brand, template or design system, follow that instead. Plain chat answers need no styling, and work that does not come from this library keeps its usual look.`;

/** The full guide, Markdown, served as aish://brand. */
export const BRAND_GUIDE = `# ${NAME} brand guide

Use this for anything made from the user's ${SHORT} library, unless the user asks for a different style.

## Name
- ${SHORT === NAME ? `Write "${NAME}" exactly like this.` : `Write "${NAME}" on first mention, "${SHORT}" after that.`} Never "AI-Summary-Helper" or "Ai Summary Helper".
- Icon: ${SITE}/assets/icon.svg (use as is, no recolouring, keep clear space around it). Website: ${SITE}

## Colour
Light theme (default):
- Page background #faf8ff, cards #ffffff with a soft 1px outline rgba(100,116,139,0.25)
- Text #0f172a, secondary text #334155, muted text #566274
- Accent #2563eb (buttons, active states, key numbers), lighter accent #3b82f6, links #1d4ed8
- Success #15803d, warning #ca8a04, danger #dc2626

Dark theme:
- Background #0b0e14, text #e8edf5, secondary #b8c4d4, muted #94a3b8
- Accent #60a5fa, links #93c5fd

Use the accent sparingly: one accent colour per view, neutrals for everything else. Charts: accent first, then #3b82f6, #93c5fd and neutral greys.

## Type
- Font: "Hanken Grotesk" (Google Fonts), falling back to Inter, system-ui, sans-serif.
- Headings bold (700), tight; body 400 at 14 to 16px with a line height of about 1.5.
- Sentence case for headings and buttons, no ALL CAPS blocks.

## Poster mode (recaps, year in review, "Wrapped"-style reports)
Plain product screens stay calm; a recap should be loud and fun. There, go big:
- One huge hero number or phrase per section, 72 to 160px, weight 800 to 900 (Hanken Grotesk ExtraBold or Black), line height 0.95, letter spacing -0.03em.
- Headlines as short, punchy statements ("255 articles. 1 busy Thursday."), set 40 to 72px, a few words in the accent colour.
- Big stat blocks instead of small tiles: the number fills the card, the label sits small underneath.
- Bolder colour: full-bleed accent sections (#2563eb with white text, or a #2563eb to #60a5fa gradient), alternating with the dark background. Still one accent family, no rainbow.
- Chunky shapes: thick bars, pill labels, big rounded corners (24 to 32px), tight layouts, a little playful rotation (1 to 2 degrees) on a sticker or badge at most.
- One idea per screen-height block; short lines, lots of contrast.

## Shape
- Rounded corners: 8px small controls, 12px inputs and chips, 16px cards, 24px sheets, fully round pills for buttons and tags.
- Soft shadows only: 0 4px 16px rgba(15,23,42,0.08) for cards.
- Generous white space; 4px spacing grid (8, 12, 16, 24, 32).

## Tone
- Plain, friendly, short sentences. Say what the reader gets, not how clever the tool is.
- Quote the user's highlights exactly and link every source by its url.
- Emoji only as small markers (one per heading at most), never as decoration.

## CSS starter
\`\`\`css
:root {
  --bg: #faf8ff; --card: #ffffff; --text: #0f172a; --text-2: #334155; --muted: #566274;
  --accent: #2563eb; --accent-2: #3b82f6; --link: #1d4ed8; --outline: rgba(100,116,139,0.25);
  --radius: 16px; --radius-sm: 8px; --shadow: 0 4px 16px rgba(15,23,42,0.08);
  font-family: "Hanken Grotesk", Inter, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b0e14; --card: #141923; --text: #e8edf5; --text-2: #b8c4d4; --muted: #94a3b8; --accent: #60a5fa; --link: #93c5fd; }
}
\`\`\`
`;

/** What the extension sends in `hello.brand`. */
export function brandDefinition() {
    return { name: NAME, short: SHORT, instructions: BRAND_INSTRUCTIONS, guide: BRAND_GUIDE };
}
