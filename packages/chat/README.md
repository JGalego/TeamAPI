# @jgalego/teamapi-chat

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-chat?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-chat)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-chat?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

Chat as a team or a specific team member from a
[Team API as Code](https://github.com/JGalego/TeamAPI) org — backed by a live tool-use loop over
the same ~12 org-graph operations `@jgalego/teamapi-mcp-server` exposes, so the persona can
answer questions about any team in the org.

Normally used via `teamapi chat --team <id> [--member <id>] [--ask <question>]`.

## Providers

The package includes two adapters:

| provider    | endpoint                           | key                           |
| ----------- | ---------------------------------- | ----------------------------- |
| `anthropic` | the Anthropic Messages API         | `ANTHROPIC_API_KEY`, required |
| `openai`    | any OpenAI Chat Completions server | `OPENAI_API_KEY`, optional    |

The `openai` adapter calls a configurable base URL with `fetch`. The shared wire format reaches
Azure OpenAI, Ollama, vLLM, llama.cpp, Together, Groq, Fireworks, OpenRouter, and most self-hosted
gateways without a vendor SDK. Authentication is optional because local models usually do not
require it.

## Install

```bash
npm install @jgalego/teamapi-chat
```

## Usage

```ts
import { buildChatPersona, buildChatTools, createChatSession } from "@jgalego/teamapi-chat";

const persona = buildChatPersona(graph, { teamId: "stream-checkout", memberId: "diego-alves" });

const session = createChatSession({
  provider: "openai",
  baseUrl: "http://localhost:11434/v1", // or omit for api.openai.com
  model: "llama3.1",
  system: persona.systemPrompt,
  tools: buildChatTools(graph),
});

const answer = await session.ask("is payments overloaded right now?");
console.log(answer.text);
if (answer.stoppedBecause) console.warn(`incomplete: ${answer.stoppedBecause}`);
```

`ask` never pretends a turn finished when it didn't: `stoppedBecause` is `tool-limit`, `refusal`
or `truncated` when the model stopped for a reason other than completing its answer.

## Adding a provider

A tool is a name, a description, a zod schema and a function — `ChatTool`, in `tool.ts`, with no
vendor content in it. An adapter converts that list to the provider's shape and drives the
call-observe-call loop, which is about a hundred lines. `runToolByName` handles the parts every
adapter needs identically: validating arguments against the schema, and turning an unknown tool or
a thrown error into a message the model can read and recover from rather than an exception that
ends the turn.

Full docs and a sample transcript: **https://github.com/JGalego/TeamAPI**

## The TeamAPI toolchain

Seven packages expose the same org graph. Install the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                       | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| [`@jgalego/teamapi-core`](https://www.npmjs.com/package/@jgalego/teamapi-core)             | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)         | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)     | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| **`@jgalego/teamapi-chat`** (this package)                                                 | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage)   | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
