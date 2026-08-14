import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AnyChatTool } from "../tool";
import { DEFAULT_MAX_TOOL_ITERATIONS, type ChatAnswer, type ChatSession, type ChatSessionOptions } from "../session";

export interface AnthropicSessionOptions extends ChatSessionOptions {
  apiKey: string;
  /** Override for a gateway or proxy; defaults to the SDK's own base URL. */
  baseUrl?: string;
  maxTokens?: number;
}

/** Per the current model catalog: always use Opus 4.8 unless the caller names a different model. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

function toAnthropicTool(tool: AnyChatTool): ReturnType<typeof betaZodTool> {
  // `betaZodTool` handles schema conversion and input validation, so the SDK's own tool runner can
  // execute the tool directly rather than this file re-implementing the loop.
  return betaZodTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    run: async (input) => tool.run(input),
  });
}

/**
 * A session backed by the Anthropic SDK's `toolRunner`, which owns the call-observe-call loop.
 *
 * The other provider adapter drives that loop by hand. That asymmetry is deliberate: where a
 * vendor ships a correct loop, using it is fewer places for a subtle bug than writing a second
 * one, and the four lines saved are not the point — the tool-result-block bookkeeping is.
 */
export function createAnthropicSession(options: AnthropicSessionOptions): ChatSession {
  const client = new Anthropic({ apiKey: options.apiKey, ...(options.baseUrl ? { baseURL: options.baseUrl } : {}) });
  const tools = options.tools.map(toAnthropicTool);
  const maxIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const messages: Anthropic.Beta.BetaMessageParam[] = [];

  return {
    describe: `anthropic (${options.model})`,

    async ask(message: string): Promise<ChatAnswer> {
      messages.push({ role: "user", content: message });

      let final: Anthropic.Beta.BetaMessage;
      try {
        final = await client.beta.messages.toolRunner({
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          max_iterations: maxIterations,
          system: options.system,
          tools,
          messages,
        });
      } catch (err) {
        // The failed turn's user message is dropped rather than left in history: retrying with it
        // still there would send the same question twice.
        messages.pop();
        throw err;
      }

      messages.push({ role: "assistant", content: final.content });
      const text = final.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      // A 200 does not mean a complete answer: `toolRunner` returns whatever the last message was
      // even when it stopped for a reason other than finishing.
      if (final.stop_reason === "tool_use") return { text, stoppedBecause: "tool-limit" };
      if (final.stop_reason === "refusal") return { text, stoppedBecause: "refusal" };
      if (final.stop_reason !== "end_turn" && final.stop_reason !== "stop_sequence") {
        return { text, stoppedBecause: "truncated", detail: final.stop_reason ?? undefined };
      }
      return { text };
    },
  };
}
