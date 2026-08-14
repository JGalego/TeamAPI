# @jgalego/teamapi-chat

Chat as a team or a specific team member from a
[Team API as Code](https://github.com/JGalego/TeamAPI) org — backed by a live tool-use loop over
the same ~12 org-graph operations `@jgalego/teamapi-mcp-server` exposes, so the persona can
accurately answer questions about any team, not just its own.

Normally used via `teamapi chat --team <id> [--member <id>] [--ask <question>]`.

## Providers

Two adapters, which is what the interoperability landscape actually has:

| provider    | endpoint                           | key                           |
| ----------- | ---------------------------------- | ----------------------------- |
| `anthropic` | the Anthropic Messages API         | `ANTHROPIC_API_KEY`, required |
| `openai`    | any OpenAI Chat Completions server | `OPENAI_API_KEY`, optional    |

The `openai` adapter is `fetch` against a configurable base URL rather than a vendor SDK, because
that wire format is the de facto interoperability layer: Azure OpenAI, Ollama, vLLM, llama.cpp,
Together, Groq, Fireworks, OpenRouter and most self-hosted gateways all speak it. The key is
optional so a model running locally — which has none — is not the one case that fails.

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

## License

MIT
