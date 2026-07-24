---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi apply <patterns...> --org <github-org> [--yes]`: reconciles real GitHub teams and memberships with the resolved org graph, the way `terraform plan`/`apply` reconciles infrastructure. One GitHub team per Team API team (matched by slug === team id), members resolved via a new optional `Member.githubUsername` field. Always prints a plan first (`+ create team`, `+`/`- add`/`remove @user`, `!` for members with no `githubUsername` set) and only writes to GitHub when re-run with `--yes`. Exported from `@jgalego/teamapi-core` as `GithubClient`, `planGithubTeamsApply`, `formatApplyPlan`, and `executeGithubTeamsApply`.
