# @jgalego/teamapi-chat

Chat as a team or a specific team member from a
[Team API as Code](https://github.com/JGalego/TeamAPI) org — backed by a live
[Anthropic tool-use loop](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview) over
the same ~12 org-graph operations `@jgalego/teamapi-mcp-server` exposes, so the persona can
accurately answer questions about any team, not just its own.

Normally used via `teamapi chat --team <id> [--member <id>] [--debug]`, which requires
`ANTHROPIC_API_KEY`.

## Install

```bash
npm install @jgalego/teamapi-chat @anthropic-ai/sdk
```

## Usage

```ts
import Anthropic from "@anthropic-ai/sdk";
import { buildChatPersona, buildChatTools, DEFAULT_CHAT_MODEL } from "@jgalego/teamapi-chat";

const persona = buildChatPersona(graph, { teamId: "stream-checkout", memberId: "diego-alves" });
const tools = buildChatTools(graph);

const client = new Anthropic();
const message = await client.beta.messages.toolRunner({
  model: DEFAULT_CHAT_MODEL,
  max_tokens: 4096,
  system: persona.systemPrompt,
  tools,
  messages: [{ role: "user", content: "is payments overloaded right now?" }],
});
```

Full docs and a sample transcript: **https://github.com/JGalego/TeamAPI**

## License

MIT
