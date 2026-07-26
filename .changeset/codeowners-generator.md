---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add a `generate codeowners` target: one CODEOWNERS file per repository, owned by
the team that declares the service. Owners are written as `@org/team-id` with
`--org`, or as members' `githubUsername` handles without it. A repository claimed
by two teams is reported as a conflict and exits non-zero rather than being
assigned to whichever team sorted first.
