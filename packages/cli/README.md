<div align="center">
  <img src="https://raw.githubusercontent.com/JGalego/TeamAPI/main/docs/assets/logo.svg" alt="TeamAPI" width="96">
</div>

# @jgalego/teamapi

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

**Who owns this? Just `curl` your org.**

Write your org as **Team API as Code** — one `teamapi.yml` per team declaring services, roles,
members, interactions and cognitive load, reviewed in pull requests and versioned in git — and
`teamapi` turns it into organigrams, org-health checks, a REST API with a live dashboard, an MCP
server for LLM assistants, a chat persona per team, trend reports over your git history, and
config for tools like [CrewAI](https://crewai.com/) and [Backstage](https://backstage.io/).

## Install

```bash
npm install -g @jgalego/teamapi
```

## Quick start

```bash
teamapi init my-org                       # scaffold a whole org repo: config, CI, first teams
teamapi validate examples/acme-org
teamapi render examples/acme-org --scope topology
teamapi serve-api examples/acme-org --port 3000   # REST API + dashboard at /dashboard
teamapi serve-mcp examples/acme-org       # point Claude Desktop/Code at this command
teamapi chat examples/acme-org --team stream-checkout --ask "is payments overloaded?"
```

`<patterns>` in every command accepts a file, a glob, or a directory to auto-discover every
`teamapi.yml`/`.yaml` under it — or comes from `teamapi.config.yml` so the everyday commands
take no arguments at all.

## Commands

**Author and validate**

| Command                                            | Purpose                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `teamapi init [dir]`                               | Scaffold a whole org repository: config, CI workflow, first teams       |
| `teamapi scaffold <id> --type <type> --out <file>` | Generate one minimal, schema-valid document                             |
| `teamapi validate <patterns...>`                   | Resolve every `$ref` transitively; report unresolved refs and conflicts |
| `teamapi fmt <patterns...> [--check]`              | Rewrite documents into canonical form (comment-preserving)              |
| `teamapi migrate <patterns...>`                    | Bring documents up to the latest `teamApiVersion`                       |
| `teamapi schema`                                   | Print the document JSON Schema for editors and CI                       |

**Check the org's shape** — all four take `--format text|json|sarif` for CI annotation

| Command                                        | Purpose                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `teamapi gaps <patterns...>`                   | Report accountability holes between teams — unowned event contracts, vacant seats, unowned agents |
| `teamapi policy <patterns...>`                 | Check declared `policies[]`, and report the ones nothing enforces                                 |
| `teamapi topology <patterns...>`               | Report Team Topologies design smells — overrunning collaborations, inverted platform flow         |
| `teamapi shadow-ai <patterns...> --scan <dir>` | Report AI adoption found in repositories against what teams declare in `agents[]`                 |

**See and track it**

| Command                                                                                | Purpose                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `teamapi render <patterns...> --scope topology\|hierarchy\|context-map\|org-hierarchy` | Render a Mermaid/DOT diagram                                                   |
| `teamapi diff <patterns...> --against <ref>`                                           | Diff the resolved org graph against a git revision                             |
| `teamapi history <patterns...> --period week`                                          | Trends over git history: cognitive load, agent adoption, supervision, churn    |
| `teamapi digest <patterns...> [--webhook <url>]`                                       | Gaps/policy/topology findings and what moved since last run, to Slack or email |

**Serve it**

| Command                                              | Purpose                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `teamapi serve-api <patterns...>`                    | REST API + dashboard; opt-in `--metrics`, `--mcp`, `--embeddings`, `--propose-to`, `--watch` |
| `teamapi serve-mcp <patterns...>`                    | MCP server over stdio, for Claude Desktop/Code                                               |
| `teamapi chat <patterns...> --team <id> [--ask <q>]` | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint                       |

**Connect it to everything else**

| Command                                                                                                      | Purpose                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `teamapi import github-org\|backstage\|okta\|slack\|csv <arg> --out <dir>`                                   | Bootstrap documents from the systems an org already has            |
| `teamapi generate crewai\|backstage\|paperclip\|codeowners\|agents-md\|port\|otel <patterns...> --out <dir>` | Generate config for another tool from the org graph                |
| `teamapi apply <patterns...> --org <github-org> [--yes]`                                                     | Reconcile GitHub teams/memberships (plan by default)               |
| `teamapi apply-to slack\|okta\|pagerduty <patterns...> [--yes]`                                              | Reconcile membership in Slack usergroups, Okta groups, PagerDuty   |
| `teamapi slack-sync <patterns...> [--yes]`                                                                   | Set each declared Slack channel's topic to name the owning team    |
| `teamapi okta-drift` / `pagerduty-drift` / `paperclip-drift`                                                 | Read-only drift reports against live systems                       |
| `teamapi doctor github\|slack\|pagerduty\|okta\|paperclip`                                                   | Check a live integration: auth, the read, field shapes, pagination |

See **[teamapi.dev](https://teamapi.dev/latest/index.html)** (or the
[main README](https://github.com/JGalego/TeamAPI#readme)) for the full walkthrough, rendered
diagrams, REST/MCP reference, and the extended spec.

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **`@jgalego/teamapi`** (this package)                                                      | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)             | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)         | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)     | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)             | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage)   | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
