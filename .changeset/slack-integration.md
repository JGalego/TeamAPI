---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

Add a Slack integration: a `/whoowns` slash-command endpoint on the REST API,
mounted only when `SLACK_SIGNING_SECRET` is set and verifying Slack's request
signature in constant time with a five-minute replay window; and a `slack-sync`
command that sets each declared channel's topic to name the owning team, with the
same plan/apply split as `teamapi apply`.
