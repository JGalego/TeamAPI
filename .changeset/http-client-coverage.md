---
"@jgalego/teamapi-core": patch
"@jgalego/teamapi": patch
---

Move the PagerDuty and Okta HTTP calls out of their CLI commands into
`PagerDutyClient` and `OktaClient`, alongside the existing GitHub and Slack
clients, and cover all three against a stubbed fetch: auth schemes, pagination
contracts, and the failure modes that would otherwise read as an empty result.
Okta's link-following now refuses to revisit a page, so a malformed `Link` header
can't loop forever.
