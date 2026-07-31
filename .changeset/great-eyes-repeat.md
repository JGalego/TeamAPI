---
"@jgalego/teamapi-core": minor
---

`deriveContextBundle` now returns `seams[]`: every pair of teams the matched entries span, with the
interaction `mode` declared between them and `undeclared: true` when neither team declares any edge
to the other.

A bundle otherwise reads as if the goal belongs to whichever team was scoped, when in practice the
highest-scoring entries routinely straddle a boundary — which is where the risk is. Naming the seam
tells an assistant who else has a stake before it starts rather than after someone notices, and an
undeclared seam deserves more caution than a declared one, not less.

Purely additive, and derived from the `teamId` each `ScoredEntry` already carries, so it costs one
pass and no extra lookups. `POST /context` and the `get_context_bundle` MCP tool pass it through
unchanged.
