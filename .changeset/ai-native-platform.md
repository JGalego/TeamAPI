---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi-mcp-server": minor
---

Add ten AI-native resource domains to the Team API document schema — agents, memory, specifications, steering documents (with organization -> team -> project inheritance via the platform-team chain), prompts (with rendering), playbooks, policies, knowledge base entries, workflows, and AI session history — all additive/optional, so existing documents keep parsing unchanged.

Adds a matching REST/MCP surface: `GET`/`list_*`/`get_*` for every new domain, `POST /teams/:id/prompts/:promptId/render`/`render_prompt`, unified search now covers every new domain, plus two new capabilities: context bundles (`POST /context`/`get_context_bundle`) that assemble the goal-relevant slice of specs/steering/policies/memory/knowledge base/prompts/playbooks for an AI assistant, and a cross-resource knowledge graph (`GET /knowledge-graph`, traversal) linking teams, people, agents, and documents by ownership, role, and reference edges.
