---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi-mcp-server": minor
"@jgalego/teamapi-chat": minor
---

Serve `teamapi gaps` over HTTP and MCP, and link agents to the humans accountable for them.

- **`GET /gaps`**, the **`get_org_gaps`** MCP tool, and a matching chat tool. `gaps` is a pure
  function of the resolved graph with no token and no I/O — the same shape as `/cognitive-load` —
  so unlike the drift checks there is no reason it should be CLI-only. An assistant asking "what is
  nobody responsible for here?" can now compute the answer instead of waiting for a CI log.
- **`accountableFor`** (member → agent) in the knowledge graph, resolved from `agents[].ownerId`.
  Emitted only when the id resolves to a declared member: a dangling `ownerId` is `gaps`'s blocking
  `dangling-owner` finding, and drawing an edge to a person who isn't there would launder exactly
  the false impression of accountability that finding exists to catch.
- The knowledge graph's role-edge relations gain `advises`/`learnsFrom`/`communityOfPractice`,
  matching the informal `alignsWith[].kind` values.
