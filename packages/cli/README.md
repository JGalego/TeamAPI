# @jgalego/teamapi

The `teamapi` CLI — write your org as a **Team API as Code** spec (one YAML file per team) and
turn it into organigrams, a REST API, an MCP server for LLM assistants, a live chat, and config
for other tools like [CrewAI](https://crewai.com/) and [Backstage](https://backstage.io/).

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

| Command                                                                                                                                                     | Purpose                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `teamapi validate <patterns...>`                                                                                                                            | Resolve every `$ref` transitively and report unresolved refs                                      |
| `teamapi gaps <patterns...>`                                                                                                                                | Report accountability holes between teams — unowned event contracts, vacant seats, unowned agents |
| `teamapi shadow-ai <patterns...> --scan <dir>`                                                                                                              | Report AI adoption found in repository checkouts against what teams declare in `agents[]`         |
| `teamapi render <patterns...> --scope topology\|hierarchy\|context-map\|org-hierarchy [--format mermaid\|dot] [--team <id>] [--with-agents] [--out <file>]` | Render a diagram                                                                                  |
| `teamapi scaffold <id> --type <type> [--name <name>] --out <file>`                                                                                          | Generate a minimal, schema-valid document                                                         |
| `teamapi generate crewai\|backstage\|paperclip\|codeowners\|agents-md\|port\|otel <patterns...> [--team <id>] --out <dir>`                                  | Generate config for another tool from the org graph                                               |
| `teamapi diff <patterns...> --against <ref>`                                                                                                                | Diff the resolved org graph against a git revision                                                |
| `teamapi import github-org <org> --out <dir>`                                                                                                               | Bootstrap `teamapi.yml` documents from an existing GitHub org                                     |
| `teamapi apply <patterns...> --org <github-org> [--yes]`                                                                                                    | Reconcile GitHub teams/memberships with the org graph (plan by default)                           |
| `teamapi slack-sync <patterns...> [--yes]`                                                                                                                  | Set each declared Slack channel's topic to name the team that owns it                             |
| `teamapi okta-drift <patterns...> --url <url>`                                                                                                              | Report where declared members and an Okta directory group disagree                                |
| `teamapi pagerduty-drift <patterns...>`                                                                                                                     | Report where PagerDuty and the org graph disagree about who gets paged                            |
| `teamapi paperclip-drift <patterns...> --url <url> --company <id>`                                                                                          | Report drift between the org graph and a running Paperclip company                                |
| `teamapi doctor github\|slack\|pagerduty\|okta\|paperclip`                                                                                                  | Check a live integration: auth, the read, field shapes, pagination                                |
| `teamapi serve-api <patterns...> [--port 3000]`                                                                                                             | Start the read-only REST API                                                                      |
| `teamapi serve-mcp <patterns...>`                                                                                                                           | Start the MCP server                                                                              |
| `teamapi chat <patterns...> --team <id> [--member <id>] [--model <id>] [--debug]`                                                                           | Chat as a team or team member (requires `ANTHROPIC_API_KEY`)                                      |

See the [main README](https://github.com/JGalego/TeamAPI#readme) for the full walkthrough,
rendered diagrams, REST/MCP reference, and the extended spec.

## License

MIT
