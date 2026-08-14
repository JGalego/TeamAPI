# @jgalego/teamapi-rest-api

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-rest-api?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-rest-api?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

A read-only [Fastify](https://fastify.dev/) REST API over a resolved
[Team API as Code](https://github.com/JGalego/TeamAPI) org graph — teams, roles, services,
interactions, dependencies, cognitive load, the three org checks (`/gaps`, `/policy`,
`/topology`), DDD context mapping, context bundles, a cross-resource knowledge graph, every
AI-native document domain, and diagrams. Every collection route paginates (`limit`/`offset`,
`X-Total-Count`, RFC 8288 `Link`) and every `GET` carries a content-derived `ETag`.

On top of the JSON routes:

- **`/dashboard`** — a live browser dashboard: team cards with cognitive-load bars, health
  checks, an agent roster with unowned agents marked, the context map with its conflicts, a
  walkable knowledge graph, search, diagrams, and (when enabled) an "edit this team → open a
  PR" form. One static page, no separate process or build step.
- **`/docs`** — interactive Swagger UI.
- **Opt-in surfaces** — `/metrics` (Prometheus), `POST /mcp` (MCP over Streamable HTTP),
  `GET /backstage/catalog`, `POST /teams/:id/proposals`, semantic `/search`. `GET /health`
  reports which of them this server has, so clients can adapt.

![Searching the dashboard for "oauth" and "architecture" surfaces steering docs, prompts, ADRs, sessions, a specification, an AI agent, and a memory entry — all through the same search box.](https://raw.githubusercontent.com/JGalego/TeamAPI/main/docs/assets/dashboard-demo.gif)

Normally started via the `teamapi serve-api` CLI command rather than embedded directly, but it's a
plain Fastify plugin if you want to mount it yourself.

**Local by default, exposable on purpose.** The CLI binds `127.0.0.1` with no auth, which is
right for local use. Binding beyond loopback requires a bearer token (`--token` /
`TEAMAPI_API_TOKEN`) or an explicit `--allow-anonymous`; CORS origins and a per-minute rate
limit are options rather than defaults. The org data this serves — team structure, cognitive
load self-assessments, member names and contacts — is not something to expose unauthenticated
on a shared network, so the server refuses to do it silently.

## Install

```bash
npm install @jgalego/teamapi-rest-api
```

## Usage

```ts
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { buildServer } from "@jgalego/teamapi-rest-api";

const store = new OrgGraphStore({ seedUris: [...] });
await store.load();
const app = await buildServer(store, { logger: true });
await app.listen({ port: 3000, host: "127.0.0.1" });
```

Full docs, endpoint reference, and examples: **https://github.com/JGalego/TeamAPI**

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                       | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)             | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)         | Zod schemas and TypeScript types for the extended spec                              |
| **`@jgalego/teamapi-rest-api`** (this package)                                             | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)             | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage)   | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
