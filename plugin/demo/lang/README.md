# Adding a language to the demo and the videos

German, English, Spanish, Japanese and Korean are built into `demo-library-i18n.js`, `demo-scenarios-i18n.js` and `videos/src/clips.ts`.
Every language added later (pt, nl, fr, sv) is two files and nothing else:

| File | What |
|---|---|
| `plugin/demo/lang/<code>.js` | the demo's content in that language: sample library, feeds, recorded answers, scenario texts |
| `videos/src/texts/<code>.ts` | the video texts: hook, spoken text, subtitles, a few on-screen strings, the end card |

`node videos/scripts/check-lang.mjs <code>` (run from the repo root as `cd videos && node scripts/check-lang.mjs pt`) lists everything that is
missing or wrong. Keep going until it prints `✔`. Do not edit any other file.

## Codes and registers

`pt` = Brazilian Portuguese (the extension's strings are in `plugin/src/_locales/pt_BR/`), `sv` = Swedish (the Nordic market), the others as usual.
Register and tone per market: `docs/i18n/locales.json` (the `market` notes). The videos are spoken aloud by a TTS voice, so write
what a friendly narrator would say, not stiff translation. The English text is the meaning, German is the reference wording.

## `plugin/demo/lang/<code>.js`

```js
window.AISH_DEMO_LANG = window.AISH_DEMO_LANG || {};
window.AISH_DEMO_LANG['pt'] = {
  titles: [ /* 28 strings: the titles of the demo library, same order as `library` in plugin/demo/demo-content.js */ ],
  extras: [ /* 5 strings: the 5 light-hearted EXTRAS in demo-library-i18n.js (the ones with a title per language) */ ],
  feeds: { subs: [ /* 6 feed names */ ], items: [ ['title', 'snippet'] /* x18, same order as demo-content.js */ ] },
  recap: { overview: '…', themes: ['…'], mood: 'positive' },        // like RECAPS.de in demo-library-i18n.js
  briefing: [ /* 5 lines with the citation markers {1} … {8}, like BRIEFINGS.de */ ],
  fun: { stream: '…', html: '…' },                                    // like FUN.de (the "standup comedian" summary)
  highlight: { quote: '…', text: '…', questions: ['…'] },             // like HIGHLIGHT.de; quote = verbatim from the article
  highlightRe: 'highlight|…',                                         // regex source: the word for "highlight" in that language
  libraryText: { keyPoints: '…', tail: '…' },                         // like D.libraryText.de
  topics: { software: '…', privacy: '…' /* every key of TOPICS in demo-library-i18n.js */ },
  scenarioTopics: { sleep: '…', learning: '…' },
  scenarios: { /* every key used as t('key', 'English') in plugin/demo/demo-scenarios.js; see demo-scenarios-i18n.js, `de` for the model */ },
};
```

The article of the demo page (and so every verbatim quote) is the one for your language in `plugin/demo/demo-i18n.js` (`AISH_DEMO_I18N[code].article`):
quotes (`highlight.quote`, `scenarios['gh.quotes']`) must appear in it word for word.

Rules for `scenarios` (see the header of `demo-scenarios-i18n.js`): keep the HTML tags; `rs.overview` keeps the English section
headings `## Agree` / `## Disagree` / `## Missing` and the `[1]`…`[5]` references; the quotes `yt.a0s`, `yt.a1s`, `pdf.a0s` must appear verbatim
in the translated `yt.p0`…`yt.p4` / `pdf.p0`…`pdf.p3`; `yt.sleepRe` is a regex source matching the word for sleep in the question chip;
the journal paper (title, authors) stays English like a real paper.

## `videos/src/texts/<code>.ts`

```ts
import type { LangTexts } from './types.ts';
export const TEXTS: LangTexts = {
  clips: {
    zusammenfassen: { hook: '…', hookMark: '…', voiceover: '…', cues: ['…', '…', '…'] },
    // … every clip id in videos/src/clips.ts
  },
  outro: { tagline: '…', badges: ['…', '…', '…'], voice: '…' },   // like OUTRO in clips.ts (Free / Open source / Own key or local)
};
```

Per clip (read it in `videos/src/clips.ts`; the `en` and `de` texts are your source):
- `hook`: the big line on top. Keep it about as short as the English one (one or two lines in a 1080 px caption, about 50 characters at most).
- `hookMark`: a part of the hook that gets the hand-drawn marker (must occur in `hook` exactly).
- `voiceover`: what the narrator says after the hook (hook and voiceover are spoken in one take). About as long as the English one, so the clip length stays as planned.
- `cues`: one subtitle per cue of the clip, same order and count as `cues` in clips.ts.
- `steps`: only for steps that have a text per language, keyed by the index in the clip's `steps` array (the checker names them):
  `click` with `hasText` = a button label in the extension's UI, which must be the exact string from the extension's own translation
  (`plugin/src/_locales/<code>/messages.json`; find the English label's key in `_locales/en/messages.json`; where the extension is still English
  in your language, use the English label); `type` = what the cursor types into a field (library search: a word that occurs in one of
  your `titles`, the sleep/memory article; language search: the first letters of the name of Japanese in your UI language, check
  `plugin/src/modules/languageManager.js` for how the search works); `mark` = a verbatim quote from your article.
- `kindle`: for clips that have one, the title of the article that arrives on the Kindle (the translated title from your `titles`, or the article title).
- `readAloud` (clip `instant`): what the extension's voice reads: the article title, the "From <site>." and "Writing a 200-word summary" announcements as the
  extension says them in your language (strings in `_locales`), then the two summary sentences from `scenarios['in.s0']`, `['in.s1']`.

Use the extension's own words for its screens and buttons in cues and voiceovers (as they appear in `_locales/<code>/`) so what is said matches what is seen.
Never claim more than the English text does. Do not translate "AI Summary Helper", "Kindle", "Ollama", "byPhil Cloud".

## Chinese: `zh` (simplified) and `zh-tw` (traditional)

Mandarin is spoken once. The audio of `zh` is reused for `zh-tw` (batch-render.mjs copies it), so the spoken part must match it:

- `zh`: write natural spoken Mandarin in simplified characters. The extension's strings are in `plugin/src/_locales/zh_CN/`. Chinese has no spaces: hooks of about 20 characters at most.
- `zh-tw`: the strings are in `plugin/src/_locales/zh_TW/`. **`hook` and `voiceover` of every clip (and `readAloud`, and `outro.voice`) must be the `zh` sentences converted character by character into traditional characters, nothing else changed**
  (same words, same order, same length), because the audio is the `zh` recording. Do not switch to Taiwanese vocabulary there (the spoken
  words would no longer match what is shown). Everything that is only read, not heard, may use the Taiwan wording and the exact
  `zh_TW` UI strings: `cues`, `hookMark` (still a part of the converted hook), `steps` (UI labels must be the `zh_TW` strings), the demo
  content in `plugin/demo/lang/zh-tw.js` (titles, feeds, recorded answers, scenarios) and `kindle`. Library and article texts follow the
  article in `AISH_DEMO_I18N['zh-tw']`.
- Both: `highlightRe` and the search words for the clips must occur in the Chinese strings and titles. The checker (`node scripts/check-lang.mjs zh` / `zh-tw`) tells what is missing; for `zh-tw` it also compares the length of hook + voiceover with `zh`.
