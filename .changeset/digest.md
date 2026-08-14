---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

`teamapi digest` merges gaps, policy and topology findings with what moved since the last run, and posts it to a Slack/Teams webhook, an HTML file for email, or stdout. State is a JSON file rather than a database, so a scheduled run can keep it in a workflow cache. `.github/workflows/digest.yml` runs it weekly, opt-in.
