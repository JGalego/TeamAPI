---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
---

Add an optional `cognitiveLoad.supervision` (1-10): the load of supervising AI agents — reviewing
what they produce, maintaining prompts, being the person everyone asks — which no role description
covers today.

It is deliberately **not** part of `total`, but it **is** one of the label's independent triggers,
on the same thresholds as `extraneous` (≥4 elevated, ≥7 overloaded). Those are two separate
decisions: the three Team Topologies types are what `total`'s thresholds are calibrated against, so
summing a fourth term would re-scale it for every team that adopted an agent — but the label has
never been a function of `total` alone, and a team drowning in agent review must not be able to
report "sustainable" on the strength of three modest other scores. A team that has not scored
`supervision` is unaffected: an absent value reads as 0.

The value reaches `/cognitive-load`, `get_team_cognitive_load` and `GET /teams/:id` (via a new
field on `CognitiveLoadDto`). It is kept out of `extraneous` because reviewing an agent's output is
often the work rather than avoidable friction around it.

`teamapi gaps` gains an `unscored-supervision` warning for teams that assess their cognitive load
and run active agents but leave the new field blank.
