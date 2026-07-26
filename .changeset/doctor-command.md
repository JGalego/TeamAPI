---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi doctor <github|slack|pagerduty|okta>`, which verifies a live
integration: authentication, the read, the field shapes the drift checks depend
on, and whether pagination is actually followed. The pagination check asks for one
item per page and counts what comes back, so it needs no large account and reports
`skip` rather than a pass when there is nothing to page through. Each client gains
a `verify()` so a rejected token can no longer be mistaken for an empty account.
Read-only; exits 1 on any failing check.
