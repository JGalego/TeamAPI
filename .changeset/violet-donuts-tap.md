---
"@jgalego/teamapi-mcp-server": minor
"@jgalego/teamapi-rest-api": minor
"@jgalego/teamapi": minor
---

Serve MCP over Streamable HTTP with `serve-api --mcp`.

MCP was stdio-only, which requires the documents on the same machine as the model — so every
laptop held its own copy of the org graph, each as current as the last time somebody pulled. The
same tools are now served at `POST /mcp` on the REST API's port, behind the same bearer token,
alongside `--watch` so one endpoint answers with the org as of the last commit.

Stateless: a fresh server and transport per request, no session id issued or required. Every tool
is a pure read of the graph, so there is no per-client state worth keeping, and any instance
behind a load balancer can answer any request.

The handler is injected into `buildServer`, so the REST API package keeps no MCP dependency.
