import * as readline from "node:readline/promises";
import { buildOrgGraph } from "@jgalego/teamapi-core";
import {
  buildChatPersona,
  buildChatTools,
  createChatSession,
  MissingApiKeyError,
  type ChatAnswer,
  type ChatSession,
  type ChatProviderName,
  type ChatToolCall,
} from "@jgalego/teamapi-chat";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface ChatOptions {
  team: string;
  member?: string;
  provider?: ChatProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  debug?: boolean;
  /** One question, one answer, then exit. */
  ask?: string;
  /** `--ask` only: print just the answer text, with no banner and no progress. */
  quiet?: boolean;
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

  console.error();
  console.error(gray(`  ⚙  ${call.name}(${inputText})`));
  console.error(gray(`     → ${indentContinuationLines(shown, TOOL_OUTPUT_INDENT)}`));
  if (truncated) {
    console.error(gray(`${TOOL_OUTPUT_INDENT}… (${pretty.length} chars total)`));
  }
}

/** The one-line note explaining a turn that stopped for a reason other than finishing. Returned
 * rather than printed so `--ask` can send it to stderr and the interactive loop to stdout. */
export function stopNote(answer: ChatAnswer, maxIterations: number): string | undefined {
  switch (answer.stoppedBecause) {
    case "tool-limit":
      return `(hit the ${maxIterations}-tool-call limit before finishing — try a narrower question.)`;
    case "refusal":
      return "(response withheld by the model for this message.)";
    case "truncated":
      return `(response ended early${answer.detail ? `: ${answer.detail}` : ""}.)`;
    default:
      return undefined;
  }
}

const MAX_TOOL_ITERATIONS = 20;

interface Prepared {
  session: ChatSession;
  personaName: string;
  systemPrompt: string;
}

/** Everything both modes need: resolve, build the persona, open a session. Returns an exit code
 * instead of a session when something is wrong, so both modes report failures identically. */
async function prepare(patterns: string[], options: ChatOptions): Promise<Prepared | number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
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

  // Progress goes to stderr, never stdout: `--ask` is meant to be piped, and a stream of dots in
  // the middle of the answer would make the output unusable for the case it exists for.
  const showProgress = !options.quiet;
  const tools = buildChatTools(graph, {
    onToolCall: options.debug ? printToolCall : showProgress ? () => process.stderr.write(gray(".")) : undefined,
  });

  try {
    const session = createChatSession({
      provider: options.provider ?? "anthropic",
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      system: persona.systemPrompt,
      tools,
      maxToolIterations: MAX_TOOL_ITERATIONS,
    });
    return { session, personaName: persona.name, systemPrompt: persona.systemPrompt };
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

/**
 * One question, one answer on stdout, exit.
 *
 * The mode that makes this usable from anything other than a keyboard. Everything except the
 * answer goes to stderr — banner, tool progress, the note about a turn that stopped early — so
 * `teamapi chat ... --ask "who owns checkout-api?"` composes with a pipe, and a CI job or a script
 * gets the answer and nothing else.
 */
async function runAsk(prepared: Prepared, question: string, options: ChatOptions): Promise<number> {
  if (!options.quiet) {
    console.error(bold(`Asking ${prepared.personaName}`) + gray(` via ${prepared.session.describe}`));
  }
  if (options.debug) {
    console.error(dim("\n--- system prompt ---"));
    console.error(dim(prepared.systemPrompt));
    console.error(dim("---------------------\n"));
  }

  let answer: ChatAnswer;
  try {
    answer = await prepared.session.ask(question);
  } catch (err) {
    console.error(red(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  if (!options.quiet && !options.debug) console.error("");
  console.log(answer.text);

  const note = stopNote(answer, MAX_TOOL_ITERATIONS);
  if (note) {
    console.error(gray(`  ${note}`));
    // Non-zero, because a truncated answer that exits 0 is a script silently acting on half a
    // reply — the one failure this mode is most likely to cause and least likely to notice.
    return 2;
  }
  return 0;
}

async function runInteractive(prepared: Prepared, options: ChatOptions): Promise<number> {
  console.log(bold(`Chatting as ${prepared.personaName}`) + gray(` via ${prepared.session.describe}.`));
  console.log(gray("Type 'exit' or Ctrl+D to quit."));
  if (options.debug) {
    console.log(dim("\n--- system prompt ---"));
    console.log(dim(prepared.systemPrompt));
    console.log(dim("---------------------\n"));
  } else {
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question(cyan(bold("You> ")));
      } catch {
        break; // EOF (Ctrl+D)
      }
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      let answer: ChatAnswer;
      try {
        answer = await prepared.session.ask(trimmed);
      } catch (err) {
        console.error(red(err instanceof Error ? err.message : String(err)));
        continue;
      }

      const note = stopNote(answer, MAX_TOOL_ITERATIONS);
      console.log(`\n${magenta(bold(`${prepared.personaName}>`))} ${answer.text}`);
      console.log(note ? gray(`  ${note}\n`) : "");
    }
  } finally {
    rl.close();
  }
  return 0;
}

/** Chat as a team or a team member, backed by a live tool-use loop over the resolved org graph. */
export async function runChat(patterns: string[], options: ChatOptions): Promise<number> {
  const prepared = await prepare(patterns, options);
  if (typeof prepared === "number") return prepared;

  return options.ask === undefined ? runInteractive(prepared, options) : runAsk(prepared, options.ask, options);
}
