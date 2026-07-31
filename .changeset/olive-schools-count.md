---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
---

Add an optional `cognitiveLoad.supervision` (1-10): the load of supervising AI agents — reviewing
what they produce, maintaining prompts, being the person everyone asks — which no role description
covers today.

It is deliberately **not** part of `total` and does not affect the `sustainable`/`elevated`/
`overloaded` label. The three Team Topologies load types are what the thresholds are calibrated
against, so folding a fourth term in would silently re-label every team that adopted an agent; it
is reported alongside instead, reaching `/cognitive-load`, `get_team_cognitive_load` and
`GET /teams/:id` (via a new field on `CognitiveLoadDto`). It is also kept out of `extraneous`,
because reviewing an agent's output is often the work rather than avoidable friction around it.

`teamapi gaps` gains an `unscored-supervision` warning for teams that assess their cognitive load
and run active agents but leave the new field blank.
