import * as readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buildOrgGraph } from "@teamapi/core";
import { buildChatPersona, buildChatTools, DEFAULT_CHAT_MODEL, type ChatToolCall } from "@teamapi/chat";
import { expandSeeds } from "../seeds";

export interface ChatOptions {
  team: string;
  member?: string;
  model?: string;
  debug?: boolean;
}

const useColor = process.stdout.isTTY;
const paint =
  (code: string) =>
  (s: string): string =>
    useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold = paint("1");
const dim = paint("2");
const cyan = paint("36");
const magenta = paint("35");
const gray = paint("90");
const red = paint("31");

const TOOL_OUTPUT_PREVIEW_LENGTH = 300;

/** Collapses a tool's output to one line for the `--debug` preview — re-compacts pretty-printed
 * JSON (dropping its indentation) and flattens anything else (e.g. a rendered diagram) by
 * folding whitespace, so a single tool call is always a single line of debug output. */
function compactPreview(output: string): string {
  let compact: string;
  try {
    compact = JSON.stringify(JSON.parse(output));
  } catch {
    compact = output.replace(/\s+/g, " ").trim();
  }
  return compact.length > TOOL_OUTPUT_PREVIEW_LENGTH
    ? `${compact.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)}… (${compact.length} chars total)`
    : compact;
}

function printToolCall(call: ChatToolCall): void {
  const inputText = JSON.stringify(call.input);
  console.log(gray(`  ⚙  ${call.name}(${inputText})`));
  console.log(gray(`     → ${compactPreview(call.output)}`));
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
  const tools = buildChatTools(graph, { onToolCall: options.debug ? printToolCall : undefined });
  const model = options.model ?? DEFAULT_CHAT_MODEL;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  console.log(bold(`Chatting as ${persona.name}`) + gray(` (model: ${model}). Type 'exit' or Ctrl+D to quit.`));
  if (options.debug) {
    console.log(dim("\n--- system prompt ---"));
    console.log(dim(persona.systemPrompt));
    console.log(dim("---------------------\n"));
  } else {
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question(cyan(bold("You> ")));
      } catch {
        break; // EOF (Ctrl+D)
      }
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      messages.push({ role: "user", content: trimmed });

      let finalMessage: Anthropic.Beta.BetaMessage;
      try {
        finalMessage = await client.beta.messages.toolRunner({
          model,
          max_tokens: 4096,
          system: persona.systemPrompt,
          tools,
          messages,
        });
      } catch (err) {
        console.error(red(err instanceof Error ? err.message : String(err)));
        messages.pop();
        continue;
      }

      messages.push({ role: "assistant", content: finalMessage.content });

      const text = finalMessage.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      console.log(`\n${magenta(bold(`${persona.name}>`))} ${text}\n`);
    }
  } finally {
    rl.close();
  }
  return 0;
}
