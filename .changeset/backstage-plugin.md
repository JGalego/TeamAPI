---
"@jgalego/teamapi-backstage": minor
"@jgalego/teamapi-rest-api": minor
---

`GET /backstage/catalog` serves the org as Backstage entities — the same generator `teamapi generate backstage` writes, served rather than written. The new `@jgalego/teamapi-backstage` package is a catalog entity provider that polls it, with no `@backstage/*` dependency.
