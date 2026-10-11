# AISH phone inbox API

`openapi.yaml` is the contract; `reference-server.mjs` is a zero-dependency in-memory implementation used by the tests
(`tests/test130.mjs`) and as the spec to port to `api.byphil.eu`. Neither is shipped in the extension.

Run locally: `node inbox-api/reference-server.mjs 8787`, then point `createInboxManager({ api })` at
`http://127.0.0.1:8787/v1/projects/ai_summary_helper/inboxes`.

Porting checklist (production): persistent store with the same semantics; constant-time token-hash comparison; the limits in
`x-limits`; purge jobs (7-day unclaimed items, 30-day idle inboxes); per-IP rate limits behind the proxy; no logging of bodies,
tokens or links; TLS only.
