# @jgalego/teamapi

The `teamapi` CLI — write your org as a **Team API as Code** spec (one YAML file per team) and
turn it into organigrams, a REST API, an MCP server for LLM assistants, a live chat, and config
for other tools like [CrewAI](https://crewai.com/).

Full docs, examples, and the extended spec: **https://github.com/JGalego/TeamAPI**

## Install

```bash
npm install -g @jgalego/teamapi
```

## Quick start

```bash
teamapi validate examples/acme-org
teamapi render examples/acme-org --scope topology
teamapi serve-api examples/acme-org --port 3000
teamapi serve-mcp examples/acme-org       # point Claude Desktop/Code at this command
teamapi chat examples/acme-org --team stream-checkout --member diego-alves
```

`<patterns>` in every command accepts a file, a glob, or a directory to auto-discover every
`teamapi.yml`/`.yaml` under it.

## Commands

| Command | Purpose |
|---|---|
| `teamapi validate <patterns...>` | Resolve every `$ref` transitively and report unresolved refs |
| `teamapi render <patterns...> --scope topology\|hierarchy\|context-map\|org-hierarchy [--format mermaid\|dot] [--team <id>] [--out <file>]` | Render a diagram |
| `teamapi scaffold <id> --type <type> [--name <name>] --out <file>` | Generate a minimal, schema-valid document |
| `teamapi generate crewai <patterns...> [--team <id>] --out <dir>` | Generate CrewAI agent/task config |
| `teamapi serve-api <patterns...> [--port 3000]` | Start the read-only REST API |
| `teamapi serve-mcp <patterns...>` | Start the MCP server |
| `teamapi chat <patterns...> --team <id> [--member <id>] [--model <id>] [--debug]` | Chat as a team or team member (requires `ANTHROPIC_API_KEY`) |

See the [main README](https://github.com/JGalego/TeamAPI#readme) for the full walkthrough,
rendered diagrams, REST/MCP reference, and the extended spec.

## License

MIT
