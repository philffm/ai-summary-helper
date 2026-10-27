# aish-mcp

Lets any MCP-capable app on **this computer** — Claude Desktop, LM Studio, Cursor, VS Code,
Jan, a local agent — read (and, if you allow it, add to) your [AI Summary
Helper](https://github.com/philffm/ai-summary-helper) library: your saved articles, summaries,
highlights, Q&A, collections, feeds and saved-for-later items.

Nothing leaves your computer except what the app you connect sends to its own model. This relay
holds no library data and logs nothing of what it forwards — just a timestamp, the tool name, and
whether it succeeded. Everything else lives in the extension, which you turn on explicitly and can
turn off (or revoke) at any time from **AISH → Settings → AI apps (MCP)**.

```
LLM app (Claude Desktop, LM Studio, Cursor …)
   │ stdio  (or Streamable HTTP on 127.0.0.1 with --http)
   ▼
aish-mcp  (this package) ── stores no library data, holds no logic, only forwards
   ▲
   │ ws://127.0.0.1:47615 · opened BY the browser extension · Origin + token checked
   │
AI Summary Helper extension  ── tool definitions, search, storage reads, consent, activity log
```

## Setup

1. Open AISH → Settings → **AI apps (MCP)** and turn it on.
2. In a terminal: `npx aish-mcp pair` — this prints a pairing code and stores a token in
   `~/.config/aish-mcp/config.json` (Windows: `%APPDATA%\aish-mcp`).
3. Paste the code into the AISH settings page. It should say "Connected" within a couple of
   seconds once a relay is actually running (step 4).
4. Add `aish-mcp` to your app's MCP config (see below) and restart that app.

Everything is **off by default**: with the setting off, the extension never opens a socket, and
`aish-mcp` without a connected extension answers every tool call with a clear
"AISH is not running" error instead of hanging or crashing.

## Config snippets

> ⚠️ MCP config file formats move around between app versions — these are current as of this
> writing; check the app's own docs if one of these stops working.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aish": { "command": "npx", "args": ["-y", "aish-mcp"] }
  }
}
```

**Cursor** (`.cursor/mcp.json` or global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "aish": { "command": "npx", "args": ["-y", "aish-mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "aish": { "command": "npx", "args": ["-y", "aish-mcp"], "type": "stdio" }
  }
}
```

**LM Studio** and other apps that only speak HTTP: run `aish-mcp --http` (default
`http://127.0.0.1:47616/`) and point the app at that URL with header
`Authorization: Bearer <your pairing token>`.

**Jan** / anything else with generic "custom MCP server" support: command `npx`, args
`["-y", "aish-mcp"]`, same as Claude Desktop/Cursor above.

## CLI

```
aish-mcp              run the stdio relay (what your MCP app launches)
aish-mcp --http       also expose a Streamable HTTP endpoint on 127.0.0.1
aish-mcp --port <n>   relay port the extension connects to (default 47615)
aish-mcp pair         print the pairing code again
aish-mcp reset        generate a new pairing token (old one stops working immediately)
aish-mcp status       show config dir, pairing state, and whether something is on the relay port
```

## Several apps (or copies) at once

Apps often start more than one copy of `aish-mcp` (Claude Desktop starts one for chat and more for
its other surfaces), and you can connect several apps at the same time. The first copy owns the
relay port; every later copy joins it and forwards its calls through it. If the first copy exits,
another one takes the port over within about a second, and the extension reconnects to it.

The relay keeps the last tool definitions (names, descriptions, input schemas — never library
content) in `tool-definitions.json` next to the pairing token, so an app that starts before your
browser still sees the AISH tools. When the browser connects later, the app is told the list changed.

## What it can and can't do

| Tool | What it does | Permission in AISH |
|---|---|---|
| `search_library` | Search saved articles (optionally by tag, date, collection) | Your library |
| `get_article` | One article: summary, highlights | Your library |
| `get_article` with `include: ["fulltext"]` | The saved text as plain text (max 40,000 characters) | Full article text |
| `list_highlights` | Highlights, newest first | Your library |
| `list_due` | Saved-for-later items due soon | Your library |
| `list_collections`, `get_collection` | Collections and their sources | Your library |
| `library_stats` | Counts only: saves over time, top tags/sites/models, mood, highlights | Your library |
| `list_feed_items` | Items from feed subscriptions | Feeds |
| `save_url` | Save a link to the AISH inbox (http/https, 30 per hour, marked "added by AI app") | Save links |

It cannot edit or delete anything, or do anything while the browser is closed. Articles with the
exclude tag (`private` by default) never appear in any result or count. The tool definitions live
in the extension (`plugin/src/modules/mcp/`), so new tools ship with extension updates; this relay
only forwards them.

## Try asking

Once an app is connected, these work well. Swap the topics for your own.

**Review and recall**
- "Summarize everything I saved in the last 7 days, grouped by theme, with my highlights quoted."
- "Pull my highlights tagged `X` and turn them into a study sheet or flashcards."
- "What's due in my saved-for-later list? Rank it by what I'd regret skipping and give me a 2-line brief for each."

**Research and writing**
- "Search my library for `topic`, read the top 5 articles in full, and write a brief that says which article each claim came from." (needs *Full article text*)
- "Do any of my saved articles on `topic` disagree? Show both sides with sources."
- "Write a blog post outline on `topic` using only what's in my library."
- "Turn my `Collection` collection into an annotated bibliography or a reading order."

**About your own habits** (these use counts only, via `library_stats`)
- "What does my saving pattern say about my interests this quarter? What is rising and what has faded?"
- "Which topics do I save a lot but never highlight?"

**Feeds and inbox**
- "From my feed items, pick the 5 worth saving based on my library, and save them." (needs *Feeds* and *Save links*)

**Coding apps (Cursor, VS Code)**
- "Find articles in my library about `library X` and use them as context for this change."

**On a schedule:** an agent can run `list_due` and `list_feed_items` each morning and write you a brief.

The same prompts are in AISH → Settings → AI apps (MCP), where you can tap one to copy it.

## Troubleshooting

- **AISH panel says "Not connected":** no relay is running. Start your AI app, or run `aish-mcp` in a terminal.
- **The app lists no AISH tools, or misses new ones after an extension update:** quit the app completely and reopen it. Some apps (Claude Desktop among them) only read the tool list at start.
- **"AISH is not running":** the browser is closed or the feature is off.
- **"Scope … is not enabled":** turn that permission on in the AISH panel; no reconnect needed.
- **Logs:** the relay logs one line per call (time, tool, ok/error, duration) to stderr; in Claude Desktop see `~/Library/Logs/Claude/mcp-server-aish.log`.

## Security notes

- The relay binds to `127.0.0.1` only, never `0.0.0.0` — nothing on your network can reach it.
- A browser tab trying `ws://127.0.0.1:47615` directly is rejected: only a request whose `Origin`
  is the AISH extension's own `chrome-extension://…` (or `moz-extension://…`) origin is accepted,
  and the first message on that connection still has to carry the right pairing token.
- The HTTP mode additionally requires a `Host: 127.0.0.1`/`localhost` header and a bearer token,
  and sends no CORS headers — a web page cannot drive it either.
- Every scope you haven't explicitly turned on in AISH is refused in the extension, not here —
  this relay is treated as untrusted plumbing even by its own author.

## Development

```
cd mcp && npm install
node bin/cli.js pair        # same as aish-mcp pair
node bin/cli.js             # stdio relay
```

Point an app at `node /path/to/ai-summary-helper/mcp/bin/cli.js` to run from the repo. Extension-side
tests: `npm test -- 178` in the repo root.
