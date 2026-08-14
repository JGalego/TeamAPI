---
"@jgalego/teamapi-chat": minor
"@jgalego/teamapi": minor
---

Chat is no longer hardwired to one vendor. `ChatTool` is a provider-neutral tool definition, `createChatSession` picks an adapter, and `--provider openai --base-url ...` reaches any OpenAI-compatible server (Azure, Ollama, vLLM, Together, Groq, OpenRouter, …) with no vendor SDK. `teamapi chat --ask "<question>"` runs one turn, prints the answer on stdout with everything else on stderr, and exits 2 if the answer is incomplete.
