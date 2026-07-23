import * as readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { buildOrgGraph } from "@jgalego/teamapi-core";
import { buildChatPersona, buildChatTools, DEFAULT_CHAT_MODEL, type ChatToolCall } from "@jgalego/teamapi-chat";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

/** Hard ceiling on tool round-trips per user turn: without this, a model stuck in a
 * call-observe-call loop has no cost/latency guard and no way to ever hand back control. */
const MAX_TOOL_ITERATIONS = 20;

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

const TOOL_OUTPUT_PREVIEW_LENGTH = 3000;
const TOOL_OUTPUT_INDENT = "       "; // aligns continuation lines under "→ "

/** Re-indents a JSON tool output as pretty-printed JSON (dropping any indentation the tool
 * itself already applied and re-formatting from scratch, so nesting never stacks); anything
 * that isn't JSON (e.g. a rendered diagram) is left as-is. Exported for direct unit testing. */
export function prettyToolOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    return output;
  }
}

/** Exported for direct unit testing. */
export function indentContinuationLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : indent + line))
    .join("\n");
}

function printToolCall(call: ChatToolCall): void {
  const inputText = JSON.stringify(call.input);
  const pretty = prettyToolOutput(call.output);
  const truncated = pretty.length > TOOL_OUTPUT_PREVIEW_LENGTH;
  const shown = truncated ? pretty.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH) : pretty;

  console.log();
  console.log(gray(`  ⚙  ${call.name}(${inputText})`));
  console.log(gray(`     → ${indentContinuationLines(shown, TOOL_OUTPUT_INDENT)}`));
  if (truncated) {
    console.log(gray(`${TOOL_OUTPUT_INDENT}… (${pretty.length} chars total)`));
  }
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
  warnUnresolved(graph);
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
  // Outside --debug, still surface that a tool call happened (not the full call/response) so a
  // multi-tool-call turn reads as "working" rather than looking indistinguishable from a hang.
  const tools = buildChatTools(graph, {
    onToolCall: options.debug ? printToolCall : () => process.stdout.write(gray(".")),
  });
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
          max_iterations: MAX_TOOL_ITERATIONS,
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

      // A 200 response doesn't mean a complete answer: `toolRunner` returns whatever the last
      // message was even if it stopped for a reason other than naturally finishing, so surface
      // that instead of silently printing an empty or truncated reply as if nothing were wrong.
      if (finalMessage.stop_reason === "tool_use") {
        console.log(`\n${magenta(bold(`${persona.name}>`))} ${text}`);
        console.log(
          gray(`  (hit the ${MAX_TOOL_ITERATIONS}-tool-call limit before finishing — try a narrower question.)\n`),
        );
      } else if (finalMessage.stop_reason === "refusal") {
        console.log(`\n${magenta(bold(`${persona.name}>`))} ${red("(response withheld by the model for this message.)")}\n`);
      } else if (finalMessage.stop_reason !== "end_turn" && finalMessage.stop_reason !== "stop_sequence") {
        console.log(`\n${magenta(bold(`${persona.name}>`))} ${text}`);
        console.log(gray(`  (response ended early: stop_reason=${finalMessage.stop_reason})\n`));
      } else {
        console.log(`\n${magenta(bold(`${persona.name}>`))} ${text}\n`);
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}
