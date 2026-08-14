---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

`teamapi history` resolves the org at a series of past git revisions and reports the trend: cognitive load, agent adoption, supervision creep, vacancies, blocking gaps and team churn, sampled per commit/day/week/month/quarter, as a table, JSON or CSV. `GitRefLoaderRegistry` and `gitRepoRoot` move into core, where `diff` and `history` now share them.
