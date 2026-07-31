---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi shadow-ai <patterns...> --scan <dir>`, which reports AI adoption found in repository
checkouts against what teams declare in `agents[]`: MCP configs, agent instruction files,
assistant config directories, LLM SDKs in manifests, and workflow steps that call a model. Local
and offline — it reads checkouts already on disk, with no clone, fetch or token.

Only `forbidden` (artifacts in a repo owned by a team whose policies forbid agents) exits non-zero;
undeclared usage warns. `scanForAiArtifacts`, `planShadowAi`, `formatShadowAi` and `repoNameFromUrl`
are exported from core, and `agentsForbidden` is now exported from the paperclip-drift module so
both checks share one definition of what a policy forbidding agents looks like.
