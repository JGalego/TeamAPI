---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add a `generate port` target emitting a Port catalog as `blueprints.json` and
`entities.json` — a team, service and person blueprint, with services related to
their owning team. Unlike the Backstage target it carries `cognitiveLoad` and its
label, which Port can score, threshold and alert on.
