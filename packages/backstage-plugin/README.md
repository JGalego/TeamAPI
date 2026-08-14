# @jgalego/teamapi-backstage

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-backstage?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-backstage)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-backstage?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

A Backstage catalog entity provider that reads a live
[Team API as Code](https://github.com/JGalego/TeamAPI) server, so the catalog never drifts from
the org graph.

`teamapi generate backstage` writes `catalog-info.yaml` files, which suits an org that wants the
catalog in git. It does not suit an org that already has Backstage: a generated file is a snapshot,
correct until somebody changes a team document and wrong until somebody remembers to regenerate.
That gap is where a catalog stops being trusted.

## Install

```bash
npm install @jgalego/teamapi-backstage
```

## Use

```ts
import { TeamApiEntityProvider } from "@jgalego/teamapi-backstage";

const provider = new TeamApiEntityProvider({
  baseUrl: "http://teamapi:3000",
  token: process.env.TEAMAPI_API_TOKEN, // only if the server was started with one
  refreshIntervalMs: 5 * 60 * 1000,
});

builder.addEntityProvider(provider);
```

It polls `GET /backstage/catalog` — the same generator `teamapi generate backstage` uses, served
rather than written — so there is no second mapping between the two models to keep in sync.

## Decisions worth knowing about

**No `@backstage/*` dependency.** `EntityProvider` is a structural interface, and depending on
`@backstage/plugin-catalog-node` to get it would pull the framework and its peer set into a
workspace of YAML parsers, and pin this to one Backstage version — the thing most likely to be
wrong for any given installation. The three shapes it needs are twenty lines, written out here, so
this is a plain TypeScript module any Backstage version accepts.

**A `full` mutation, under one stable location.** That's what lets a team removed from the org
graph leave the catalog. An incremental mutation would leave it there forever, which is the exact
failure the generated-file approach already had.

**A failed refresh leaves the catalog alone.** A Team API server being briefly unreachable is not
a reason to empty somebody's service catalog — which is precisely what a `full` mutation of zero
entities would do. The previously ingested entities stay; the error goes to `onError` if you gave
one, and is otherwise rethrown so the host's logger sees it. It is never logged from inside the
library, and never swallowed — a catalog frozen by silent failures looks exactly like one that is
up to date.

**Entities are checked before they are applied.** One with no `kind` or `name` crashes the catalog
processor several layers away from the server that produced it, so the provider rejects the whole
response instead.

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                       | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)             | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)         | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)     | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)             | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| **`@jgalego/teamapi-backstage`** (this package)                                            | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
