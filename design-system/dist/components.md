# AISH components

Generated from `design-system/components.json` and `plugin/src/styles.css` by `design-system/components.mjs`. Do not edit. Figma: Library v3 on the Components page of the AISH file.

## Button

Status: stable · Figma node 1257:183

Start an action. Primary for the one main action on a screen (Summarize, Connect), Secondary for the rest, Ghost for low-emphasis, Danger for destructive confirmations, Danger outline for destructive actions in lists and settings.

- CSS: `.button-primary`, `.button-secondary`, `.button-danger`, `.button-danger-outline`, `.btn-sm`, `.btn-md`
- Source: `plugin/src/popup.html`
- Variants: Variant (Primary / Secondary / Ghost / Danger / Danger outline) · Size (L / M / S) · State (Default / Hover / Disabled / Focus)
- Properties: Label (text), Icon (text), Show icon (boolean)
- Tokens: `--accent`, `--accent-glow`, `--accent-light`, `--danger`, `--danger-text`, `--duration-fast`, `--easing-standard`, `--fs-lg`, `--fs-md`, `--fs-sm`, `--glass-border`, `--glass-card`, `--glass-inner-glow`, `--glass-input`, `--on-accent`, `--on-solid`, `--outline`, `--radius-md`, `--spacing-s-3`, `--text-primary`
- Accessibility:
  - <button> (never a div); disabled is the native attribute, not only opacity
  - Focus: --focus-ring, offset 2px
  - Size S is 30px min height, keep 8px apart (WCAG 2.5.8)
  - Danger outline text and border use --danger-text
- Do:
  - One Primary per view
  - Verb first: “Summarize”, “Send to Kindle”
- Don't:
  - Two Primary buttons side by side
  - Danger fill for something that can be undone

## Icon button

Status: stable · Figma node 1257:202

A square button with only an icon: header settings, graph and analytics toggles.

- CSS: `.button-icon`
- Source: `plugin/src/popup.html`
- Variants: Style (Glass / Accent / Plain) · State (Default / Hover / Active / Focus / Disabled)
- Properties: Icon (text)
- Tokens: `--duration-fast`, `--easing-standard`, `--fs-xl`, `--glass-card`, `--glass-inner-glow`, `--outline`, `--radius-md`, `--text-primary`
- Accessibility:
  - aria-label is required (WCAG 4.1.2)
  - 36px target
  - aria-pressed when it toggles a view
- Do:
  - Icons that are understood without text
- Don't:
  - Actions that need a word to be understood

## Chip

Status: stable · Figma node 1257:212

Small toggle or picker in the composer chip row (language, length, mode, model, PDF).

- CSS: `.chip`, `.chip.active`
- Source: `plugin/src/popup.html`, `plugin/src/modules/composerState.js`
- Variants: Selected (False / True) · State (Default / Hover / Focus / Disabled)
- Properties: Label (text), Icon (text), Show icon (boolean)
- Tokens: `--accent`, `--accent-a12`, `--accent-a30`, `--duration-fast`, `--easing-standard`, `--focus-ring`, `--focus-ring-offset`, `--focus-ring-width`, `--fs-2xs`, `--glass-input`, `--on-solid`, `--outline`, `--radius-md`, `--text-primary`, `--text-secondary`
- Accessibility:
  - aria-pressed for toggles, role=radio inside a group of exclusive options
  - Selected is told by fill + border + text colour
- Do:
  - Short labels, an icon if it helps
- Don't:
  - Long text: use a select or a sheet

## Tag

Status: stable · Figma node 1257:222

Topic tag on cards and in the article view; Suggestion for suggested follow-up questions; Removable in the editor.

- CSS: `.tag-chip`, `.chat-suggest-chip`
- Source: `plugin/src/modules/articleManager.js`, `plugin/src/modules/mainScreen.js`
- Variants: Style (Accent / Suggestion / Removable / Removable focus)
- Properties: Label (text)
- Tokens: `--accent`, `--accent-a08`, `--accent-a15`, `--accent-a30`, `--focus-ring`, `--focus-ring-offset`, `--focus-ring-width`, `--fs-2xs`, `--fs-sm`, `--fs-xs`, `--outline`, `--radius-full`, `--tone-arch-bg`, `--tone-arch-fg`, `--tone-new-bg`, `--tone-new-fg`, `--tone-read-bg`, `--tone-read-fg`, `--tone-sent-bg`, `--tone-sent-fg`
- Accessibility:
  - Removable: the ✕ is its own button with aria-label “Remove tag X”
- Do:
  - Lowercase or title case consistently
- Don't:
  - Tags as the only way to filter

## Status badge

Status: stable · Figma node 1257:235

Shows an article status: New, Read, Sent, Archived, Saved (no AI), Signed in.

- CSS: `.status-badge`
- Source: `plugin/src/modules/articleManager.js`, `plugin/src/modules/inboxView.js`
- Variants: Tone (New / Read / Sent / Archived / Saved / Signed in)
- Properties: Label (text)
- Tokens: `--fs-2xs`, `--ok`, `--on-solid`, `--tone-arch-bg`, `--tone-arch-fg`, `--tone-new-bg`, `--tone-new-fg`, `--tone-read-bg`, `--tone-read-fg`, `--tone-sent-bg`, `--tone-sent-fg`
- Accessibility:
  - The word carries the status, colour only supports it
  - tone-*-fg on tone-*-bg ≥ 5.4:1
- Do:
  - One badge per card
- Don't:
  - Badges as buttons

## Switch

Status: stable · Figma node 1257:244

On/off setting that takes effect at once.

- CSS: `.switch`, `.slider-toggle`
- Source: `plugin/src/popup.html`, `plugin/src/modules/accordion.js`
- Variants: On (true / false) · State (Default / Disabled / Focus)
- Tokens: `--accent`, `--accent-light`, `--duration-base`, `--easing-standard`, `--elevation-1`, `--outline`, `--radius-full`, `--switch-knob`
- Accessibility:
  - <input type=checkbox role=switch> inside the row <label>
  - Knob vs track ≥ 3:1
- Do:
  - Settings that apply immediately
- Don't:
  - Choices that need a Save: use a checkbox

## Segmented item

Status: stable · Figma node 1258:60

One option of a segmented control.

- CSS: `.sendsheet-seg button`, `.ps-seg button`
- Source: `plugin/src/modules/sendSheet.js`, `plugin/src/modules/promptSettings.js`
- Variants: Selected (True / False) · State (Default / Hover / Focus)
- Properties: Label (text)
- Tokens: `--field-bg`, `--radius-md`
- Accessibility:
  - role=radio + aria-checked, arrow keys move

## Segmented control

Status: stable · Figma node 1258:61

2–4 mutually exclusive options shown at once (summary length, send format).

- CSS: `.sendsheet-seg`, `.ps-seg`
- Source: `plugin/src/modules/sendSheet.js`, `plugin/src/modules/promptSettings.js`
- Tokens: `--field-bg`, `--radius-md`
- Accessibility:
  - role=radiogroup with aria-label
- Do:
  - Up to 4 short options
- Don't:
  - More than 4 options: use a select

## Tab

Status: stable · Figma node 1258:78

One tab of the shared underline tab bar.

- CSS: `.tabbar-btn`, `.tabbar-ind`
- Source: `plugin/src/modules/tabbar.js`
- Variants: Selected (True / False) · State (Default / Hover / Focus)
- Properties: Label (text), Count (text), Show count (boolean)
- Tokens: `--duration-base`, `--duration-fast`, `--duration-slower`, `--easing-spring`, `--easing-standard`, `--fs-md`, `--nav-blob-bg`, `--text-muted`, `--text-primary`, `--text-secondary`
- Accessibility:
  - role=tab, aria-selected, roving tabindex, ←/→ move
  - Selected label is 600 and primary, not only the indicator

## Tab bar

Status: stable · Figma node 1258:79

Switches views inside History (Inbox, Read, Sent, Research, Collections, Archive) and Feeds (Feed, Day, Week, Month).

- CSS: `.tabbar`
- Source: `plugin/src/modules/tabbar.js`
- Tokens: `--outline`
- Accessibility:
  - role=tablist with aria-label
- Do:
  - Up to 6 tabs, counts optional
- Don't:
  - Tabs for actions

## Nav item

Status: stable · Figma node 1258:111

One destination in the bottom nav.

- CSS: `.nav-item`, `.nav-blob`
- Source: `plugin/src/popup.html`, `plugin/src/modules/uiManager.js`
- Variants: Selected (True / False) · State (Default / Hover / Focus)
- Properties: Label (text), Icon (text)
- Tokens: `--duration-base`, `--duration-slower`, `--easing-spring`, `--easing-standard`, `--fs-2xl`, `--fs-2xs`, `--nav-active-text`, `--nav-blob-bg`, `--radius-md`, `--text-muted`, `--text-secondary`
- Accessibility:
  - aria-current="page" on the selected item
  - Label always visible

## Bottom nav

Status: stable · Figma node 1258:112

Main navigation: Feeds, Summarize, History, Notes.

- CSS: `.bottom-nav`
- Source: `plugin/src/popup.html`, `plugin/src/modules/tabbar.js`
- Tokens: `--bottom-nav-height`, `--nav-bg`, `--outline`, `--z-nav`
- Accessibility:
  - <nav aria-label="Main">
  - ≥ 44px targets
- Do:
  - Four destinations
- Don't:
  - Actions in the nav

## Search field

Status: stable · Figma node 1258:134

Search in History, Feeds, Notes and Settings.

- CSS: `#searchInput`, `.notes-search`, `.chip-panel-search`
- Source: `plugin/src/popup.html`, `plugin/src/modules/notesView.js`
- Variants: State (Default / Focus / Filled / Disabled)
- Properties: Placeholder (text)
- Tokens: `--accent`, `--fs-sm`, `--glass-input`, `--outline`, `--radius-sm`, `--spacing-s-2`, `--text-primary`
- Accessibility:
  - <input type=search> with an accessible name
  - Clear button with aria-label
- Do:
  - Shortcut in the placeholder where one exists

## Settings row

Status: stable · Figma node 1258:149

A row that opens a settings panel or an item (Settings home, Send & Share targets, AI apps).

- CSS: `.settings-row`, `.settings-row-icon`, `.settings-row-title`, `.settings-row-sub`
- Source: `plugin/src/popup.html`, `plugin/src/modules/settingsNav.js`, `plugin/src/modules/sendTargets.js`
- Variants: State (Default / Hover / Focus / Disabled)
- Properties: Title (text), Subtitle (text), Icon (text), Show subtitle (boolean)
- Tokens: `--accent`, `--accent-a15`, `--danger-text`, `--fs-2xl`, `--fs-base`, `--fs-sm`, `--fs-xl`, `--glass-card`, `--glass-input`, `--outline`, `--radius-md`, `--radius-sm`, `--text-muted`, `--text-primary`
- Accessibility:
  - One <button> per row, the whole row is the target
  - The subtitle states the current value
- Do:
  - Subtitle shows the state (“3 places · synced 2m ago”)
- Don't:
  - Two actions in one row

## Article card

Status: stable · Figma node 1258:204

A saved article in History and Feeds: title, meta, status, tags, ⋯ menu.

- CSS: `.article-card`
- Source: `plugin/src/modules/articleManager.js`, `plugin/src/modules/inboxView.js`, `plugin/src/modules/feedManager.js`
- Variants: State (Default / Focus / Selected / Hover)
- Properties: Title (text), Meta (text), Show tags (boolean)
- Tokens: `--accent`, `--duration-base`, `--easing-standard`, `--favorite`, `--glass-card`, `--outline`, `--radius-lg`, `--sel-card-bg`, `--spacing-s-3`, `--spacing-s-4`
- Accessibility:
  - The card is one link/button named by its title
  - ⋯ is a separate button (aria-haspopup=menu)
  - Select mode: checkbox state is announced
- Don't:
  - Nested interactive elements without their own names

## Card menu item

Status: stable · Figma node 1258:214

One action in the card ⋯ menu.

- CSS: `.card-menu-item`, `.card-menu-item.is-danger`
- Source: `plugin/src/modules/cardMenu.js`
- Variants: Type (Default / Danger) · State (Default / Hover / Focus)
- Properties: Label (text), Icon (text)
- Tokens: `--accent-a12`, `--accent-a15`, `--danger`, `--danger-text`, `--focus-ring`, `--focus-ring-inset`, `--focus-ring-width`, `--fs-md`, `--text-primary`
- Accessibility:
  - role=menuitem; ↑/↓ move; Esc closes and returns focus
  - Focus ring inside the item (--focus-ring-inset)
  - Danger uses --danger-text plus the trash icon

## Card menu

Status: stable · Figma node 1258:215

All actions for one article (open, copy, send, export, collection, select, archive, delete).

- CSS: `.card-menu`
- Source: `plugin/src/modules/cardMenu.js`
- Tokens: `--bg-page`, `--duration-fast`, `--easing-decelerate`, `--elevation-4`, `--outline`, `--z-popover`
- Accessibility:
  - role=menu from a button with aria-haspopup=menu + aria-expanded
- Do:
  - Destructive action last, separated
- Don't:
  - More than ~10 items (see AISH-004.3)

## Toast

Status: stable · Figma node 1258:249

Short confirmation after an action, optionally with Undo.

- CSS: `#toastStack`, `.toast-message`
- Source: `plugin/src/modules/uiManager.js`
- Variants: Type (Default / With action)
- Properties: Message (text), Action (text)
- Tokens: `--duration-slow`, `--easing-decelerate`, `--fs-md`, `--glass-base`, `--glass-border-strong`, `--radius-md`, `--shadow-modal`, `--text-primary`, `--z-toast`
- Accessibility:
  - role=status (polite)
  - The action is a real button
  - Stays ≥ 5 s and pauses on hover and focus (2.2.1)
- Do:
  - Past tense: “Sent to Kindle”
- Don't:
  - Errors that need a decision: use a callout or dialog

## Header

Status: stable · Figma node 1258:250

Top bar of the popup: logo, title, settings.

- CSS: `.header`, `.logoheader`, `.header-buttons`
- Source: `plugin/src/popup.html`
- Properties: Title (text)
- Tokens: `--bg-page`, `--duration-base`, `--easing-standard`, `--glass-base`, `--header-h`, `--spacing-s-2`, `--spacing-s-3`, `--spacing-s-5`, `--z-header`
- Accessibility:
  - Logo has alt text
  - Settings button has aria-label

## Composer

Status: stable · Figma node 1258:257

The Summarize input: chip row, page context, focus field, Summarize split button.

- CSS: `.input-card`, `.chip-row`, `.controls-bar`
- Source: `plugin/src/popup.html`, `plugin/src/modules/composerState.js`, `plugin/src/modules/mainScreen.js`
- Properties: Page (text)
- Tokens: `--accent-a10`, `--accent-a30`, `--bg-page`, `--bottom-nav-height`, `--button-working-bg`, `--controls-bottom-gap`, `--duration-base`, `--easing-in-out`, `--easing-standard`, `--focus-ring`, `--focus-ring-offset`, `--focus-ring-width`, `--glass-border`, `--glass-card`, `--glass-inner-glow`, `--nav-clearance`, `--on-solid`, `--outline`, `--radius-xl`, `--shadow-card`, `--spacing-s-1`, `--spacing-s-3`, `--spacing-s-4`, `--spacing-s-5`, `--text-secondary`, `--z-header`, `--z-raised`
- Accessibility:
  - The field has a visible label or aria-label
  - Chips are reachable before the button

## Text field

Status: stable · Figma node 1264:176

Labelled input with hint and error message (Sync & backup, AI apps).

- CSS: `.mcp-field`
- Source: `plugin/src/modules/syncView.js`, `plugin/src/modules/mcpView.js`
- Variants: State (Default / Focus / Filled / Error / Disabled)
- Properties: Label (text), Hint (text), Show hint (boolean), Error text (text), Value (text)
- Tokens: `--danger-text`, `--fs-xs`, `--text-secondary`
- Accessibility:
  - <label for>, hint and error linked with aria-describedby
  - aria-invalid on error; the message names the fix (3.3.3)
- Do:
  - Say what goes in and where to find it
- Don't:
  - Placeholder as the only label

## Selection tile

Status: stable · Figma node 1264:233

Choose one of a few options with a sentence each (Encrypted vs Readable).

- CSS: `.mcp-tile`, `.mcp-tile.is-on`
- Source: `plugin/src/modules/syncView.js`, `plugin/src/modules/mcpView.js`
- Variants: Selected (True / False) · State (Default / Hover / Focus / Disabled)
- Properties: Title (text), Hint (text), Icon (text)
- Tokens: `--accent`, `--accent-a30`, `--duration-fast`, `--focus-ring`, `--focus-ring-offset`, `--focus-ring-width`, `--glass-border`, `--glass-card`, `--text-primary`
- Accessibility:
  - As built: aria-pressed; better role=radio in a radiogroup
  - “Selected” chip text carries the state
- Do:
  - 2–4 options with one-line explanations
- Don't:
  - Options without consequences

## Status line

Status: stable · Figma node 1264:254

Dot + text that tells the state of a running thing (sync place, AI app connection).

- CSS: `.mcp-hero-status`, `.mcp-dot`
- Source: `plugin/src/modules/mcpView.js`, `plugin/src/modules/syncView.js`
- Variants: Tone (OK / Running / Error / Paused / Attention)
- Properties: Message (text), Show glyph (boolean)
- Tokens: `--accent`, `--easing-in-out`, `--fs-lg`, `--ok`, `--text-primary`
- Accessibility:
  - role=status aria-live=polite while running
  - Error must not share the “working” colour; add a glyph (1.4.1)

## Callout

Status: stable · Figma node 1264:267

Explains or warns inside a panel: Info, Warning, Danger, Alert.

- CSS: `.explanatory-card`, `.sync-warn`, `.sync-danger`, `.mcp-card[role=alert]`
- Source: `plugin/src/modules/syncView.js`, `plugin/src/modules/settingsNav.js`
- Variants: Tone (Info / Warning / Danger / Alert)
- Properties: Text (text), Show icon (boolean)
- Tokens: `--accent-a30`, `--danger`, `--danger-text`, `--fs-base`, `--fs-sm`, `--glass-border`, `--glass-card`, `--glass-inner-glow`, `--radius-lg`, `--spacing-s-2`, `--spacing-s-4`, `--text-secondary`, `--warn`
- Accessibility:
  - Alert uses role=alert; others are plain text
  - Icon repeats the meaning in shape
- Do:
  - One callout per decision
- Don't:
  - Stacking several callouts

## Progress bar

Status: stable · Figma node 1264:274

Progress of a long run (sync, upload).

- CSS: `progress.sync-progress`
- Source: `plugin/src/modules/syncView.js`
- Variants: Type (Determinate / Done / Indeterminate)
- Tokens: `--accent`
- Accessibility:
  - Native <progress> with max/value and aria-label = phase text

## Toggle row

Status: stable · Figma node 1264:287

A setting row with title, hint and a switch.

- CSS: `.mcp-row`
- Source: `plugin/src/modules/syncView.js`, `plugin/src/modules/mcpView.js`, `plugin/src/modules/notesView.js`
- Variants: On (true / false)
- Properties: Title (text), Hint (text), Show hint (boolean)
- Accessibility:
  - The whole row is the <label> of the switch

## Section caption

Status: stable · Figma node 1264:288

Uppercase caption above a group of rows or fields.

- CSS: `.settings-caption`
- Source: `plugin/src/modules/settingsNav.js`, `plugin/src/modules/syncView.js`
- Properties: Text (text)
- Tokens: `--danger-text`, `--fs-xs`, `--text-muted`
- Accessibility:
  - Should be a heading (<h3>) so screen readers can jump between groups

## Passphrase box

Status: stable · Figma node 1264:290

Shows the six recovery words, selectable in one go.

- CSS: `.sync-words`, `.sync-recovery`
- Source: `plugin/src/modules/syncView.js`
- Properties: Words (text)
- Tokens: `--glass-input`, `--outline`
- Accessibility:
  - tabindex=0, user-select all, Copy and Download next to it

## Pill segmented item

Status: stable · Figma node 1264:300

One option of the pill segmented control.

- CSS: `.a11y-seg button`
- Source: `plugin/src/popup.html`
- Variants: Selected (True / False) · State (Default / Focus)
- Properties: Label (text)
- Tokens: `--accent`, `--focus-ring`, `--focus-ring-width`, `--fs-sm`, `--glass-input`, `--on-accent`, `--outline`, `--text-secondary`
- Accessibility:
  - role=radio, aria-checked

## Pill segmented

Status: stable · Figma node 1264:301

Rounded segmented control for 2–3 options in settings and Notes (List | Grid).

- CSS: `.a11y-seg`
- Source: `plugin/src/popup.html`, `plugin/src/modules/notesView.js`, `plugin/src/modules/syncView.js`
- Tokens: `--accent`, `--focus-ring`, `--focus-ring-width`, `--fs-sm`, `--glass-input`, `--on-accent`, `--outline`, `--text-secondary`
- Accessibility:
  - role=radiogroup with aria-label

## Note card

Status: stable · Figma node 1289:334

A note, a highlight or an AI highlight in Notes (sticky), with comment, source, tags and actions.

- CSS: `.st`, `.st-user`, `.st-ghost`, `.st-note`, `.st-c`, `.st-act`
- Source: `plugin/src/modules/notesView.js`
- Variants: Kind (Highlight / AI highlight / Note) · State (Default / Hover / Focus / Editing)
- Properties: Text (text), Source (text), Tags (text), Show comment (boolean)
- Tokens: `--fs-md`, `--fs-xs`, `--outline`, `--saved-note-edge`, `--saved-note-ghost-bar`, `--saved-note-ghost-bg`, `--saved-note-ghost-fg`, `--saved-note-note-bar`, `--saved-note-note-bg`, `--saved-note-note-fg`, `--saved-note-quote-bg`, `--saved-note-user-bar`, `--saved-note-user-bg`, `--saved-note-user-fg`
- Accessibility:
  - <article> labelled with its kind
  - Actions are buttons; Remove asks first
  - Remove text --saved-note-danger ≥ 5.5:1 on every sticky
