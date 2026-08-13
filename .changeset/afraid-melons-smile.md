---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi topology` — the Team Topologies design smells.

`gaps` asks what nobody owns. This asks whether the shape is right when everything _is_ owned:
collaborations past the duration they declared for themselves or with no duration at all, teams
past the size at which they hold shared context, teams in more concurrent collaborations than they
can sustain, platform teams depending on the teams they exist to serve, and dependencies a team has
itself labelled blocking.

The collaboration checks are the point — Team Topologies is emphatic that collaboration is the
expensive, deliberately temporary mode, and a collaboration with no end date is two teams that have
merged without saying so. Nothing here was visible until something read the dates.

Everything is a warning and exits 0; thresholds and per-kind severities are configurable in
`teamapi.config.yml`. These are prompts for a conversation, not defects.
