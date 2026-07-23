---
"@jgalego/teamapi-rest-api": minor
---

Add a live browser dashboard at `GET /dashboard`: a self-contained static page (no separate process, no build step) that fetches the same REST API it's served from — a team list with type/focus, a cognitive-load bar per team (color- and icon-coded, never color alone), free-text search, and a tabbed diagram viewer (topology / org-hierarchy / context-map) rendered client-side with Mermaid loaded from a CDN. Each section loads and fails independently, so a blocked CDN only disables the diagram tab.
