---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": patch
"@jgalego/teamapi": minor
---

Add the schema migration mechanism, and version-aware diagnostics.

There is one `teamApiVersion`, so there is nothing to migrate yet — which is when the mechanism
has to exist. A format with one version and no migration path has a migration problem scheduled
for the day the second version ships, by which point documents are spread across every repository
in an org.

`MIGRATIONS` is an ordered chain a document walks toward `LATEST_TEAM_API_VERSION`, run by
`teamapi migrate`. It ships empty on purpose: a placeholder migration would be one real documents
could hit, so the runner is tested against fixtures instead.

The half that helps today is diagnosis. A version mismatch used to fail as `teamApiVersion:
Invalid literal value, expected "1.0.0"`, which reads identically whether documents are behind the
toolchain or ahead of it — opposite problems needing opposite fixes. `assessVersion` tells them
apart, and both `migrate` and `validate` now say which one you have.
