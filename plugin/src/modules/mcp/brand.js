// modules/mcp/brand.js
// The brand guide AI apps get through kaivo-mcp (`hello.brand`): short server instructions, plus the full guide served as the
// aish://brand resource and the on_brand prompt. Written in the default brand's name, colours and host, so the white-label
// build (brands/index.mjs) rewrites it like any other source file: a Koru build hands out the Koru guide.

const NAME = 'AI Summary Helper';
const SHORT = 'AISH';
const SITE = 'https://kaivo.byphil.eu';
import { PALETTES, SCHEME_IDS, paletteFor, cssFor, lookFrom } from './palettes.js';

const FULL = SHORT === NAME ? NAME : `${NAME} (${SHORT})`;
const DEFAULT_SCHEME = SHORT.toLowerCase();   // the build's own colours: a scheme of the same name (Aish, Kaivo), else Kaivo   // a brand whose short name is its name says it once


const hexOf = (p) => `background ${p.bg}, cards ${p.card} with a soft 1px outline ${p.outline}; text ${p.text}, secondary ${p.text2}, muted ${p.muted}; accent ${p.accent} (buttons, active states, key numbers), lighter accent ${p.accent2}, links ${p.link}`;

/** The colours: the user's own choice first (what the app shows), then every other scheme so the person can switch afterwards. */
function colourSection(look) {
  const sc = PALETTES[look.scheme], modeText = look.mode === 'system' ? 'follows the system (light by day, dark by night): ship both blocks of the CSS starter' : `fixed to ${look.mode}: use only the ${look.mode} block`;
  const others = SCHEME_IDS.filter((id) => id !== look.scheme).map((id) => `- ${PALETTES[id].name} (${id}): accent ${paletteFor(id, 'light').accent}, dark ${paletteFor(id, 'dark').accent}`).join('\n');
  return `## Colour
The user has chosen the colour scheme **${sc.name}** (${look.scheme}); brightness ${modeText}. Use these colours unless the user asks for others.
Light: ${hexOf(paletteFor(look.scheme, 'light'))}
Dark: ${hexOf(paletteFor(look.scheme, 'dark'))}
Success #15803d, warning #ca8a04, danger #dc2626.

Use the accent sparingly: one accent colour per view, neutrals for everything else. Charts: accent first, then the lighter accent and neutral greys.

### Offer the other colours when the work is done
Define every colour as a CSS variable in one :root block (as in the CSS starter) and never hard-code a hex value elsewhere, so a switch is only a different block. When the report is finished, tell the user in one line that it is in ${sc.name} and offer the other schemes; if they pick one, rebuild with that scheme's values (call get_brand again, or use the list below):
${others}
Full values: call get_brand and read \`schemes\`. Optionally also put a small scheme switcher into the page itself (buttons that swap the :root variables), so the reader can switch without asking you.`;
}

/** Sent as the MCP server's `instructions`: the app reads them when it connects. Kept short; the details are in aish://brand. */
export const BRAND_INSTRUCTIONS = `When you create something visual or shareable from the user's ${FULL} library (an artifact, HTML page, slide deck, document, chart, diagram or image built from articles, summaries, highlights, collections or feeds this server returned), style it in the ${NAME} brand: call get_brand (or read the aish://brand resource, or use the on_brand prompt) for colours, type, shapes and tone: it returns the colour scheme the user has chosen, and once the work is done you offer the other schemes so they can switch. The user's own request wins: if they ask for another style, brand, template or design system, follow that instead. Plain chat answers need no styling, and work that does not come from this library keeps its usual look.`;

/** The full guide, Markdown, served as aish://brand. */
export const buildGuide = (look) => `# ${NAME} brand guide

Use this for anything made from the user's ${SHORT} library, unless the user asks for a different style.

## Name
- ${SHORT === NAME ? `Write "${NAME}" exactly like this.` : `Write "${NAME}" on first mention, "${SHORT}" after that.`} Never "AI-Summary-Helper" or "Ai Summary Helper".
- Icon: ${SITE}/assets/icon.svg (use as is, no recolouring, keep clear space around it). Website: ${SITE}

${colourSection(look)}

## Type
- Font: "Hanken Grotesk" (Google Fonts), falling back to Inter, system-ui, sans-serif.
- Headings bold (700), tight; body 400 at 14 to 16px with a line height of about 1.5.
- Sentence case for headings and buttons, no ALL CAPS blocks.

## Poster mode (recaps, year in review, "Wrapped"-style reports)
Plain product screens stay calm; a recap should be loud and fun. There, go big:
- One huge hero number or phrase per section, 72 to 160px, weight 800 to 900 (Hanken Grotesk ExtraBold or Black), line height 0.95, letter spacing -0.03em.
- Headlines as short, punchy statements ("255 articles. 1 busy Thursday."), set 40 to 72px, a few words in the accent colour.
- Big stat blocks instead of small tiles: the number fills the card, the label sits small underneath.
- Bolder colour: full-bleed accent sections (the accent with white text, or a gradient from the accent to the lighter accent), alternating with the dark background. Still one accent family, no rainbow.
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

## CSS starter (the user's current colours)
\`\`\`css
${cssFor(look.scheme, look.mode)}
\`\`\`
`;

export const defaultLook = () => lookFrom({}, DEFAULT_SCHEME);
export const BRAND_GUIDE = buildGuide(defaultLook());

/** The scheme the user has set, with every scheme's values, so a report can be switched afterwards. */
export function brandNow(appearance = {}) {
    const look = lookFrom(appearance, DEFAULT_SCHEME);
    const schemes = Object.fromEntries(SCHEME_IDS.map((id) => [id, { name: PALETTES[id].name, light: paletteFor(id, 'light'), dark: paletteFor(id, 'dark') }]));
    return { guide: buildGuide(look), current: look, schemes, css: cssFor(look.scheme, look.mode) };
}

/** What the extension sends in `hello.brand` (the guide in the user's current colours; get_brand always reads them fresh). */
export function brandDefinition(appearance = {}) {
    return { name: NAME, short: SHORT, instructions: BRAND_INSTRUCTIONS, guide: brandNow(appearance).guide };
}
