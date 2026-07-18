---
"@jgalego/teamapi-core": patch
---

Fix Mermaid topology/hierarchy diagrams failing to render on GitHub ("Cannot read properties of undefined (reading 'render')") when two teams had more than one interaction/dependency/platform edge between them. Parallel edges between the same node pair are now merged into a single edge with combined labels instead of being emitted as separate lines, which GitHub's Mermaid renderer can't handle.
