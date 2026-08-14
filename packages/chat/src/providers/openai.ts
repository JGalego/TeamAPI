import { z } from "zod/v4";
import type { AnyChatTool } from "../tool";
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  runToolByName,
  type ChatAnswer,
  type ChatSession,
  type ChatSessionOptions,
} from "../session";

export interface OpenAiSessionOptions extends ChatSessionOptions {
  /** Base URL up to and including the API version, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer`. Optional, because a local Ollama or vLLM needs none. */
  apiKey?: string;
  maxTokens?: number;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChoice {
  message: OpenAiMessage;
  finish_reason?: string;
}

function toOpenAiTool(tool: AnyChatTool): unknown {
  // `z.toJSONSchema` emits draft 2020-12 with `$schema` and `additionalProperties: false`. The
  // `$schema` key is stripped: several OpenAI-compatible servers reject an unrecognised key in a
  // function's `parameters` outright, and it carries nothing the endpoint uses.
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters },
  };
}

/**
 * A session over the OpenAI Chat Completions API — which, in practice, means most of them.
 *
 * Implemented with `fetch` against a configurable base URL rather than through the OpenAI SDK, and
 * that is the whole reason this is worth having. The wire format is the de facto interoperability
 * layer: Azure OpenAI, Ollama, vLLM, llama.cpp, Together, Groq, Fireworks, OpenRouter and most
 * self-hosted gateways all speak it. A dependency on one vendor's client would buy nothing here
 * and would re-introduce exactly the coupling this replaces — while a base URL and a bearer token
 * reach all of them, including a model running on the machine with no key at all.
 *
 * The loop is driven by hand, unlike the Anthropic adapter: this endpoint has no equivalent of a
 * tool runner, so somebody has to keep the `tool_call_id` bookkeeping straight.
 */
export function createOpenAiSession(options: OpenAiSessionOptions): ChatSession {
  const tools = options.tools.map(toOpenAiTool);
  const maxIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // The system prompt is the first message rather than a separate field, which is how this API
  // models it.
  const messages: OpenAiMessage[] = [{ role: "system", content: options.system }];

  async function complete(): Promise<OpenAiChoice> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: options.maxTokens ?? 4096,
      }),
    });

    if (!res.ok) {
      // The body carries the actual reason — a bad model name, a missing key, a context overflow —
      // and a bare status code sends people to guess at all three.
      const body = await res.text().catch(() => "");
      throw new Error(`${endpoint} failed: ${res.status} ${res.statusText}${body ? `\n${body.slice(0, 2000)}` : ""}`);
    }

    const payload = (await res.json()) as { choices?: OpenAiChoice[] };
    const choice = payload.choices?.[0];
    if (!choice) throw new Error(`${endpoint} returned no choices`);
    return choice;
  }

  return {
    describe: `openai-compatible (${options.model} at ${options.baseUrl})`,

    async ask(message: string): Promise<ChatAnswer> {
      const restore = messages.length;
      messages.push({ role: "user", content: message });

      try {
        for (let iteration = 0; iteration < maxIterations; iteration++) {
          const choice = await complete();
          messages.push(choice.message);

          const calls = choice.message.tool_calls ?? [];
          if (calls.length === 0) {
            const text = choice.message.content ?? "";
            return choice.finish_reason === "length"
              ? { text, stoppedBecause: "truncated", detail: "length" }
              : { text };
          }

          for (const call of calls) {
            let input: unknown = {};
            try {
              // Arguments arrive as a JSON *string* the model wrote freehand, so a malformed one is
              // a normal occurrence rather than a bug. It goes back as a tool result the model can
              // read and retry from, not as a thrown error that ends the turn.
              input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            } catch {
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: `Error: arguments for '${call.function.name}' were not valid JSON`,
              });
              continue;
            }
            options.onToolCall?.(call.function.name);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: await runToolByName(options.tools, call.function.name, input),
            });
          }
        }

        // Out of iterations with the model still asking for tools. The last assistant message is
        // whatever it said alongside its final tool call, which is usually something.
        const last = [...messages].reverse().find((entry) => entry.role === "assistant" && entry.content);
        return { text: last?.content ?? "", stoppedBecause: "tool-limit" };
      } catch (err) {
        // Roll the whole turn back, tool results included: a half-finished exchange left in
        // history would be re-sent on the next question, and several of these endpoints reject a
        // `tool` message whose matching `tool_calls` never got an answer.
        messages.length = restore;
        throw err;
      }
    },
  };
}
