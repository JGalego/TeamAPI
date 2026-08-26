# @jgalego/teamapi-schema

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-schema?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-schema)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-schema?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

Zod schemas and inferred TypeScript types for the
[Team API as Code extended spec](https://github.com/JGalego/TeamAPI/blob/main/docs/spec/teamapi-extended-v1.md)
— roles, members, services, bounded contexts, interactions, dependencies, cognitive load
assessments, and the root `TeamApiDocument`.

## Install

```bash
npm install @jgalego/teamapi-schema
```

## Usage

```ts
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";

const doc = TeamApiDocumentSchema.parse(yourParsedYaml);
```

## Exports

- `TeamApiDocumentSchema` / `TeamApiDocument` — the root document schema and its inferred type.
- `v1` — namespace re-export of every `v1/*` schema/type (`RoleSchema`, `ServiceSchema`,
  `InteractionSchema`, `DependencySchema`, `CognitiveLoadAssessmentSchema`, `WorkSchema`,
  `MeetingSchema`, `ChannelSchema`, `SearchTermSchema`, etc.) for consumers that need a specific
  sub-schema or type rather than the whole document.
- `getTeamApiJsonSchema()` — the same schema as plain JSON Schema, for editors/IDEs or non-Zod
  consumers. The published copy lives at **https://teamapi.dev/schema/v1.json**, so a
  `# yaml-language-server: $schema=` modeline gives you validation and autocompletion as you type.
- `SCHEMA_REGISTRY`, `isSupportedVersion(version)`, `resolveSchemaForVersion(version)` — a
  forward-compatibility seam for validating a document against whichever `teamApiVersion` schema
  it declares; currently only `"1.0.0"` is registered.
- `SUGGESTED_ROLE_KINDS` — a non-exhaustive list of common `roles[].kind` values, offered for
  editor autocompletion (`roles[].kind` itself accepts any non-empty string).
- `responsibilityText(responsibility)` / `responsibilityDoneWhen(responsibility)` — helpers for
  reading a `Role.responsibilities[]` entry regardless of whether it's the plain-string or
  `{ text, doneWhen }` object form.

## Validation beyond field types

Parsing also enforces several cross-field rules:

- A role's `reportsTo` and `reportsToRef` are mutually exclusive.
- A role's `reportsTo` must match another role's `id` within the same team, and same-team
  `reportsTo` cycles (including self-reports) are rejected.
- `roles[].id` and `members[].id` must each be unique within a team.

Full docs and the extended spec: **https://github.com/JGalego/TeamAPI**

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                       | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)             | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| **`@jgalego/teamapi-schema`** (this package)                                               | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)     | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)             | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage)   | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
