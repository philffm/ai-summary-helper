# AISH phone inbox API

`openapi.yaml` is the contract; `reference-server.mjs` is a zero-dependency in-memory implementation used by the tests
(`tests/test130.mjs`) and as the spec to port to `api.byphil.eu`. Neither is shipped in the extension.

Run locally: `node inbox-api/reference-server.mjs 8787`, then point `createInboxManager({ api })` at
`http://127.0.0.1:8787/v1/projects/ai_summary_helper/aish_inboxes`.

Collections: inboxes are stored in `aish_inboxes`, their items in `aish_inbox_items` (the path segment is the collection).

Porting checklist (production): persistent store with the same semantics; constant-time token-hash comparison; the limits in
`x-limits`; per-item delete (`DELETE …/items/{itemId}`, sent only after the user summarized or dismissed the link; `/ack` is deprecated); purge jobs (30-day items, 30-day idle inboxes); per-IP rate limits behind the proxy; no logging of bodies,
tokens or links; TLS only.

## Envelope v2: articles for the phone

A second inbox, created by the extension together with the first, carries articles the other way (extension writes, phone reads;
the phone gets its read token in the pairing code as `&ti=…&tr=…`). Same API, same key, `v: 2`: the plaintext is
`gzip(JSON)` with `{v:2, url, sentAt, title, site, byline, lang, summary?, blocks:[[type,text]…], truncated?}`. Block types: `h1 h2 h3 p li q pre`.
The sender shortens an article until the gzip is at most 135,000 bytes; the server caps an item at 190,000 characters of base64url
and an inbox at 8 MB of waiting ciphertext. The phone deletes each item (`DELETE …/items/{id}`, read token) after saving it.
`tests/fixtures/inbox-vector.json` has an `article` vector every implementation must decrypt.
