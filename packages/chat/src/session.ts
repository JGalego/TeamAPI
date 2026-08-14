import type { AnyChatTool } from "./tool";

/** Why a turn stopped, when it stopped for a reason other than the model finishing its answer.
 * Surfaced rather than swallowed: a truncated reply printed as if it were complete is worse than
 * an error, because nothing about it looks wrong. */
export type ChatStopReason = "tool-limit" | "refusal" | "truncated";

export interface ChatAnswer {
  text: string;
  stoppedBecause?: ChatStopReason;
  /** Provider-specific detail for `truncated`, e.g. the raw stop reason. */
  detail?: string;
}

/** A conversation with one model. Holds its own history, in whatever shape its provider wants. */
export interface ChatSession {
  /** Which provider and model are answering, for the banner and for `--debug`. */
  readonly describe: string;
  ask(message: string): Promise<ChatAnswer>;
}

export interface ChatSessionOptions {
  system: string;
  tools: AnyChatTool[];
  model: string;
  /** Hard ceiling on tool round-trips per user turn: without it, a model stuck in a
   * call-observe-call loop has no cost or latency guard and no way to hand back control. */
  maxToolIterations?: number;
  /** Called before each tool result goes back to the model, so a caller can show progress. */
  onToolCall?: (name: string) => void;
}

export const DEFAULT_MAX_TOOL_ITERATIONS = 20;

/** Runs a tool by name and returns its output as a string, turning any failure into a message the
 * model can read and react to. A thrown error would end the whole turn over something the model
 * could often recover from by calling a different tool. */
export async function runToolByName(tools: AnyChatTool[], name: string, input: unknown): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return `Error: unknown tool '${name}'`;

  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    // Validated here rather than trusted, because the OpenAI-compatible path hands back arguments
    // as a JSON string the model wrote freehand. The Anthropic SDK validates for us; this makes
    // both paths behave the same way when a model invents a field.
    return `Error: invalid input for '${name}': ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`;
  }

  try {
    return await tool.run(parsed.data);
  } catch (err) {
    return `Error running '${name}': ${err instanceof Error ? err.message : String(err)}`;
  }
}
