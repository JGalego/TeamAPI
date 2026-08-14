---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Resolve a whole BFS level at once instead of one document at a time, and cache `https://` refs on disk between runs. `buildOrgGraph` takes `concurrency` and `cache`; the CLI reads `TEAMAPI_CACHE_DIR`, `TEAMAPI_NO_CACHE` and `TEAMAPI_RESOLVE_CONCURRENCY`. `generateSyntheticOrg` builds an org of arbitrary size for benchmarking.
