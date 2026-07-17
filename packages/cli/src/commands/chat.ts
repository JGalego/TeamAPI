import * as readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buildOrgGraph } from "@teamapi/core";
import { buildChatPersona, buildChatTools, DEFAULT_CHAT_MODEL } from "@teamapi/chat";
import { expandSeeds } from "../seeds";

export interface ChatOptions {
  team: string;
  member?: string;
  model?: string;
}

/** Interactive chat as a team or a team member, backed by a live Anthropic tool-use loop over
 * the resolved org graph. Requires `ANTHROPIC_API_KEY` in the environment. */
export async function runChat(patterns: string[], options: ChatOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Get a key from https://console.anthropic.com/ and export it.");
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  if (!graph.teams.has(options.team)) {
    console.error(`Unknown team id: ${options.team}`);
    return 1;
  }

  let persona;
  try {
    persona = buildChatPersona(graph, { teamId: options.team, memberId: options.member });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const client = new Anthropic({ apiKey });
  const tools = buildChatTools(graph);
  const model = options.model ?? DEFAULT_CHAT_MODEL;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  console.log(`Chatting as ${persona.name} (model: ${model}). Type 'exit' or Ctrl+D to quit.\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("You> ");
      } catch {
        break; // EOF (Ctrl+D)
      }
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      messages.push({ role: "user", content: trimmed });

      const finalMessage = await client.beta.messages.toolRunner({
        model,
        max_tokens: 4096,
        system: persona.systemPrompt,
        tools,
        messages,
      });

      messages.push({ role: "assistant", content: finalMessage.content });

      const text = finalMessage.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(`\n${persona.name}> ${text}\n`);
    }
  } finally {
    rl.close();
  }
  return 0;
}
