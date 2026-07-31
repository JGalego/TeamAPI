---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
---

Let `alignsWith[]` entries name what kind of informal tie they are, via an optional
`kind`: `aligns-with` (the default when omitted), `advises`, `learns-from` or
`community-of-practice`. These describe the network work actually travels along — who a role takes
advice from, who it learned a practice from, which community it belongs to — which the reporting
hierarchy never explains.

A discriminator on the existing `RoleRefSchema` rather than new arrays, so the whole `alignsWith`
resolution path is reused and a document that omits `kind` resolves and renders exactly as before.
Each kind becomes a `RoleGraphEdge` of the same name, drawn as a labelled dashed edge by
`--scope org-hierarchy` and mapped into the knowledge graph. `kind` is rejected on `reportsToRef`,
which is always formal reporting, rather than being silently ignored.

`GapsReport` gains `roleTies: { formal, informal }`, and `teamapi gaps` prints how many cross-team
role relationships the reporting lines explain when any of them aren't reporting lines.
