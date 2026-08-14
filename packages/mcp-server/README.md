# @jgalego/teamapi-mcp-server

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-mcp-server?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-mcp-server?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

An [MCP](https://modelcontextprotocol.io/) server exposing a resolved
[Team API as Code](https://github.com/JGalego/TeamAPI) org graph as tools for LLM assistants:
`list_teams`, `get_team`, `get_team_roles`, `get_team_cognitive_load`, `find_service_owner`,
`list_services`, `get_team_interactions`, `get_team_dependencies`, `get_context_map`,
`render_org_diagram`, `search_org`, `get_org_graph`, `get_org_cognitive_load_report`, and
`get_org_gaps` (the accountability holes between teams).

Each AI-native document domain adds a `list_*`/`get_*` pair — `list_agents`/`get_agent`,
`list_prompts`/`get_prompt`, and so on — alongside `render_prompt`, `get_context_bundle`,
`get_knowledge_graph` and `traverse_knowledge_graph`.

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

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                  | What it does                                                                        |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                     | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)           | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)       | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)   | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| **`@jgalego/teamapi-mcp-server`** (this package)                                         | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)           | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage) | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
