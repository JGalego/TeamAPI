---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add a `pagerduty-drift` command reporting where PagerDuty and the declared org
graph disagree about who gets paged. Only an `unresponsive` finding — a declared
service with no escalation policy, or one with nobody on it — exits non-zero, so
it can gate a required check without ordinary drift failing the build. Read-only
in both directions.
