---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

Embedding-backed search. `semanticSearchOrg` unions substring matching with cosine similarity; `createEmbeddingScorer` layers the same signal onto `deriveContextBundle` without making it async. `teamapi serve-api --embeddings` enables `GET /search?mode=hybrid|semantic` and `POST /context {semantic:true}`, against any OpenAI-compatible `/embeddings` endpoint, with vectors cached on disk.
