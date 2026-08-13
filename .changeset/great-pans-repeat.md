---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

Keep the long-running servers current with `--watch`.

`OrgGraphStore.reload()` existed and nothing ever called it, so both servers answered from a
startup snapshot for as long as they ran — worst for `serve-mcp`, where an assistant holds the
connection open for a whole session.

`--watch` re-resolves on change, `POST /reload` (or `--reload-endpoint` on its own) covers
webhook-driven refreshes, and `SIGHUP` covers process supervisors. Seed discovery re-runs on every
reload, so documents _added_ after startup are picked up too.

A failed reload never replaces a working graph: the store publishes only on success, so a document
caught mid-write is reported and skipped while the server keeps answering from the last good state.
