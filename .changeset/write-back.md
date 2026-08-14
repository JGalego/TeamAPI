---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

`teamapi apply-to <slack|okta|pagerduty>` reconciles membership in those systems with the org graph, behind the same plan-then-`--yes` shape as `apply`. Slack usergroups (created if missing), Okta group membership, and PagerDuty team membership. Schedules, escalation policies, directory groups and PagerDuty teams are never written — see each planner for why.
