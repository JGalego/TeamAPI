---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

`teamapi serve-api --metrics` mounts `GET /metrics` in the Prometheus exposition format: teams by type, cognitive and supervision load per team, agents by status, gaps/policy/topology findings, unresolved references, graph age, and the server's own request counts and latencies. `collectOrgMetrics`/`renderPrometheus` are exported from core for other exporters to reuse.
