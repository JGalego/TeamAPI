---
"@jgalego/teamapi-rest-api": minor
---

Serve policy and topology over HTTP, and show all three checks in the dashboard.

`/gaps` was already served on the argument that a check needing no credentials should be
answerable without anyone running a report; `policy` and `topology` are the same shape and were
unreachable only because they were written after the routes were. Both are now `GET /policy` and
`GET /topology`.

The dashboard gains a Health section running all three at once — counts plus one finding list
sorted most-serious-first — and a team detail panel behind each card: roles with vacancies marked,
members, services, agents and their owners, interactions and dependencies. Each check is fetched
independently, so an older server missing the new routes degrades to "unavailable" rather than a
blank section.
