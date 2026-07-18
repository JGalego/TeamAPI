# @jgalego/teamapi-mcp-server

An [MCP](https://modelcontextprotocol.io/) server exposing a resolved
[Team API as Code](https://github.com/JGalego/TeamAPI) org graph as tools for LLM assistants:
`list_teams`, `get_team`, `get_team_roles`, `get_team_cognitive_load`, `find_service_owner`,
`list_services`, `get_team_interactions`, `get_context_map`, `render_org_diagram`, `search_org`,
`get_org_graph`, `get_org_cognitive_load_report`.

Normally started via `teamapi serve-mcp` — point Claude Desktop or Claude Code at that command.

## Install

```bash
npm install @jgalego/teamapi-mcp-server
```

## Usage

```ts
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { createMcpServer } from "@jgalego/teamapi-mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const store = new OrgGraphStore({ seedUris: [...] });
await store.load();

const server = createMcpServer(store);
await server.connect(new StdioServerTransport());
```

Full docs and examples: **https://github.com/JGalego/TeamAPI**

## License

MIT
