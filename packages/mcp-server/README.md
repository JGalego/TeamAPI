# @jgalego/teamapi-mcp-server

An [MCP](https://modelcontextprotocol.io/) server exposing a resolved
[Team API as Code](https://github.com/JGalego/TeamAPI) org graph as tools for LLM assistants:
`list_teams`, `get_team`, `get_team_roles`, `get_team_cognitive_load`, `find_service_owner`,
`list_services`, `get_team_interactions`, `get_team_dependencies`, `get_context_map`,
`render_org_diagram`, `search_org`, `get_org_graph`, `get_org_cognitive_load_report`.

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

### Claude Desktop / Claude Code

Add an entry to Claude Desktop's `claude_desktop_config.json` (or Claude Code's MCP config):

```json
{
  "mcpServers": {
    "teamapi": {
      "command": "teamapi",
      "args": ["serve-mcp", "/absolute/path/to/your/org"]
    }
  }
}
```

Use an **absolute path** for both `command` and the org directory/pattern argument — Desktop
spawns this as a subprocess without your shell's `PATH`, so a bare `teamapi` only resolves if it's
on the system-wide `PATH` (e.g. installed via `npm install -g @jgalego/teamapi`); otherwise point
`command` at the full path to the installed binary (e.g. from `which teamapi`).

Full docs and examples: **https://github.com/JGalego/TeamAPI**

## License

MIT
