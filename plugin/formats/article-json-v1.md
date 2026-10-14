# AISH Article JSON v1

The exchange format for one saved article: what leaves the extension towards other tools (Markdown notes today, WebDAV, linkding, Wallabag, folder export later). Identifier: `"aish": "article/1"`.

Source of truth in code: `plugin/src/modules/articleFormat.js` (`toArticleJson`). Test vector: `plugin/tests/fixtures/article-v1-vector.json` (extension test168, Android `ArticleMarkdownTest`).

## Fields

```jsonc
{
  "aish": "article/1",                    // format and version, required
  "id": "article_1760000000000_ab12cd",   // the extension's own article id, stable, required
  "url": "https://…",                     // required
  "title": "…",                           // one line
  "site": "example.com",                  // host without www.
  "author": "…",                          // byline; left out when unknown
  "lang": "de",                           // left out when unknown
  "savedAt": "2026-10-14T09:00:00.000Z",  // when it was saved, ISO 8601 UTC
  "tags": ["…"],                          // always present, may be empty
  "mood": 0.4,                            // left out when not scored
  "summary": { "md": "…" },               // Markdown (from the summary without the follow-up edits), always present, may be ""
  "highlights": [ { "type": "user" | "ghost", "text": "…", "at": "ISO" } ],   // always present; dismissed ones are not exported
  "qa": [ { "q": "…", "a": "…" } ],       // only the pinned questions; left out when none
  "blocks": [["h2", "…"], ["p", "…"]],    // full text, only when asked for (includeBlocks); types h1 h2 h3 p li q pre
  "model": "provider/model-id"            // left out when unknown
}
```

## Rules

- **Read tolerantly.** Ignore fields you do not know and never fail on them. New optional fields stay `article/1`; only an incompatible change raises the version.
- **No secrets, no internal storage keys, no HTML.** The summary is Markdown, the text is plain blocks.
- **Times are ISO 8601 in UTC.**
- **The `id` is the identity.** A target recognises an article by `id`, not by title or URL. The title can change, the id does not.
- **`blocks` are optional** because they make the body large. A webhook that only needs the summary should not ask for them.

## Markdown note

`articleToMarkdown` (`markdownArchive.js`) builds the note from this object. Front matter:

```yaml
---
title: "…"
source: "https://…"
author: "…"        # only when known
site: "example.com"
created: 2026-10-14
tags:
  - "…"
mood: 0.4          # only when scored (extension)
aish_id: "article_1760000000000_ab12cd"   # only when known (the phone knows it once the extension sends `aid`)
aish_format: 1
url: "https://…"   # transition copy of `source`
date: 2026-10-14   # transition copy of `created`
---
```

`url` and `date` stay for one or two releases so existing Dataview queries do not break; removing them is a separate ticket. The Android app writes the same keys (`ArticleMarkdown.kt`), minus `mood` and with `tags: []`.

### File names

`safeFileName(title)`. When several articles share a title (case-insensitive), the **oldest keeps the plain name**, the others get ` (<last 6 characters of the id>)`. A note without a title is always `Untitled (<id tail>)`. The name depends only on the article and its same-titled siblings, not on the order of the archive, so exporting again into the same folder keeps every file name when new articles are added.

A changed title makes a new file name on the next export; `aish_id` in the front matter is how a later sync recognises the note.

## Relation to the phone envelope v2

Envelope v2 (`articleBlocks.articleForPhone`, `inboxCrypto.js`) stays the **transport** format: gzip, encrypted, size-limited, `hl` as `[kind, text]` pairs. JSON v1 is the **exchange** format towards other tools. `site`, `author` and `lang` come from the same helpers (`articleMeta.js`). The envelope has one optional field `aid` (the article `id`) so the phone can write `aish_id` into its notes; apps that do not know it ignore it.
