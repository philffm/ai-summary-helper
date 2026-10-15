# Target adapter contract

How the extension sends an article to a service (WebDAV, HTTP endpoint, …). Step 2 provides the machinery; adapters are added one by one. Source of truth in code: `plugin/src/modules/targets/`.

## Pieces

| Piece | Where | Job |
|---|---|---|
| Outbox | `targets/outbox.js` | durable queue, one job at a time, retry with backoff |
| Ledger | `targets/ledger.js` | what was sent where (hash, remote path, etag) |
| safeFetch | `targets/safeFetch.js` | the only network access an adapter gets |
| Payload | `targets/payload.js` | builds `md` or `json-v1` from an article id |
| Registry | `targets/adapters.js` | `registerAdapter(name, impl)`, `getAdapter(name)` |

The code runs in the background worker (`targets-worker.js`, global `AISH_TARGETS`). The popup only sends messages (`targetEnqueue`, `targetStatus`, `targetCancel`; helper `modules/targetClient.js`). Only extension pages may send them.

## Adapter

```js
registerAdapter('webdav', {
  caps:    { push: true, update: true, check: false, list: false, delete: false },
  accepts: ['md', 'json-v1'],
  // ctx = { connection, secret, target, safeFetch, log }
  async push(ctx, payload, previous) { return { remote, etag }; },   // previous = ledger entry or null
  async check(ctx, previous) { return { exists }; }                   // only when caps.check is true
});
```

- `payload` = `{ format, mime, ext, text, articleId, fileBase, fileBaseWithId }`. `fileBase` is the plain title, `fileBaseWithId` adds ` (<id tail>)`. Only the target knows about name collisions, so the adapter chooses.
- With `previous` the adapter updates instead of creating.
- Throw `TargetError({ kind, message, status? })`. Anything else thrown counts as `retry`.
- Never use the global `fetch`. Never log headers, bodies, tokens or full URLs.

## Error classes

| kind | Meaning | Outbox does |
|---|---|---|
| `retry` | network error, timeout, 408, 429, 5xx | backoff 1 min, 5 min, 30 min, 2 h, 6 h; `failed` after the 6th failed attempt. `Retry-After` is honoured when longer |
| `auth` | 401, 403 | connection gets `needsLogin: true`; all its jobs become `failed` (reason `auth`), no retry |
| `permanent` | other 4xx, unusable data, missing adapter | job is `failed` at once |

A deleted article drops its job silently.

## safeFetch rules

- `https:` is required. `http:` only when the connection has `allowInsecureLan: true` **and** the host is private (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `localhost`, `*.local`, `::1`).
- Only the origin of the connection's `baseUrl` (scheme, host, port).
- `redirect: 'error'`, `credentials: 'omit'`, `cache: 'no-store'`.
- 30 s timeout, request body and answer at most 5 MB.
- Resolves for 2xx only: `{ status, headers, bytes, text(), json() }`; everything else throws a `TargetError`.
- The log gets host and status only.

## Outbox behaviour

- Job: `{ id, targetId, articleId, enqueuedAt, attempts, nextAt, lastError?, lastMessage?, state: 'queued' | 'running' | 'failed' }`.
- The same `(targetId, articleId)` while `queued` is one job (`nextAt = now`).
- Content is built when sending, not when queueing; the queue holds ids only. At most 500 jobs.
- Same SHA-256 of the payload as in the ledger: nothing is sent (`unchanged`). With `caps.check` the adapter is asked whether the remote file still exists.
- Runs on enqueue, at worker start (a `running` job is queued again) and from the alarm `targets_outbox`.

## Storage (all new, nothing existing is touched)

| Key | Content |
|---|---|
| `targets:connections` | `[{ id, preset, baseUrl, auth, label, createdAt, needsLogin?, allowInsecureLan? }]`, no secrets |
| `targets:secrets` | `{ [connectionId]: {…} }`, secret: not in backups without the opt-in, removed by "keys" |
| `targets:list` | `[{ id, connectionId, adapter, format, options, rule }]` |
| `targets:default` | target id or empty |
| `targets:outbox` | open jobs; transient: never exported, dropped on import |
| `targets:ledger:<targetId>` | `{ [articleId]: { remote, etag?, hash, at } }` |

Connections, list, default, outbox and ledgers belong to the delete category "send".

## Not yet

Full-text `blocks` (need a DOM; will use the offscreen document: `includeBlocks: true` throws), UI, login flows, Android.
