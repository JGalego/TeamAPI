---
"@jgalego/teamapi-rest-api": minor
---

Every collection route accepts `limit`/`offset` and answers with `X-Total-Count` and an RFC 8288 `Link` header; every `GET` carries a content-derived `ETag` and honours `If-None-Match`. Both are additive — an existing client that passes neither sees exactly what it saw before.
