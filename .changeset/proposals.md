---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

`teamapi serve-api --propose-to owner/repo` mounts `POST /teams/:id/proposals`: a small, closed patch to one team becomes a pull request against the repository the documents came from, re-validated and re-formatted first. The dashboard's team panel grows an edit form when the server reports the capability. `GET /health` now reports which optional surfaces are mounted.
