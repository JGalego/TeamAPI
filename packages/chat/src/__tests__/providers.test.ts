import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { createOpenAiSession } from "../providers/openai";
import { createChatSession, MissingApiKeyError, isChatProvider, PROVIDER_DEFAULTS } from "../providers";
import { runToolByName } from "../session";
import type { AnyChatTool } from "../tool";

const echoTool: AnyChatTool = {
  name: "echo",
  description: "Echoes its input.",
  inputSchema: z.object({ text: z.string() }),
  run: async (input) => `echoed: ${(input as { text: string }).text}`,
};

const explodingTool: AnyChatTool = {
  name: "explode",
  description: "Always throws.",
  inputSchema: z.object({}),
  run: async () => {
    throw new Error("boom");
  },
};

/** Queues canned `/chat/completions` responses and records what was sent. */
function stubCompletions(bodies: unknown[]): {
  calls: Array<Record<string, unknown>>;
  fetch: ReturnType<typeof vi.fn>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body) as Record<string, unknown>);
    const next = bodies.shift();
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => next,
      text: async () => JSON.stringify(next),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetch: fetchMock };
}

const answer = (content: string) => ({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
const callsTool = (id: string, name: string, args: string) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
      },
      finish_reason: "tool_calls",
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOpenAiSession", () => {
  const base = { system: "You are a team.", tools: [echoTool], model: "gpt-4o", baseUrl: "https://api.example.com/v1" };

  it("posts to /chat/completions with the system prompt first and the tools converted", async () => {
    const { calls } = stubCompletions([answer("hello")]);
    const session = createOpenAiSession({ ...base, apiKey: "sk-test" });

    expect(await session.ask("hi")).toEqual({ text: "hello" });

    const sent = calls[0]!;
    expect(sent.model).toBe("gpt-4o");
    // This API has no separate system field; it is the first message.
    expect(sent.messages).toEqual([
      { role: "system", content: "You are a team." },
      { role: "user", content: "hi" },
    ]);
    const tools = sent.tools as Array<{
      type: string;
      function: { name: string; parameters: Record<string, unknown> };
    }>;
    expect(tools[0]!.type).toBe("function");
    expect(tools[0]!.function.name).toBe("echo");
    // `$schema` stripped: several compatible servers reject an unrecognised key in `parameters`.
    expect(tools[0]!.function.parameters).not.toHaveProperty("$schema");
    expect(tools[0]!.function.parameters).toMatchObject({ type: "object", required: ["text"] });
  });

  it("sends no Authorization header when there is no key, so a local server works", async () => {
    const { fetch: fetchMock } = stubCompletions([answer("ok")]);
    await createOpenAiSession({ ...base, baseUrl: "http://localhost:11434/v1" }).ask("hi");
    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers).not.toHaveProperty("Authorization");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const { fetch: fetchMock } = stubCompletions([answer("ok")]);
    await createOpenAiSession({ ...base, baseUrl: "https://api.example.com/v1/" }).ask("hi");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.example.com/v1/chat/completions");
  });

  it("runs a tool call and feeds the result back keyed by tool_call_id", async () => {
    const { calls } = stubCompletions([callsTool("call_1", "echo", '{"text":"pong"}'), answer("done")]);
    const seen: string[] = [];

    const session = createOpenAiSession({ ...base, onToolCall: (name) => seen.push(name) });
    expect(await session.ask("say pong")).toEqual({ text: "done" });

    expect(seen).toEqual(["echo"]);
    const second = calls[1]!.messages as Array<Record<string, unknown>>;
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: "echoed: pong" });
  });

  it("hands malformed tool arguments back as a result the model can recover from", async () => {
    // The arguments are a JSON string the model wrote freehand, so this is a normal occurrence
    // rather than a bug — and ending the turn over it would lose the whole exchange.
    const { calls } = stubCompletions([callsTool("call_1", "echo", "{not json"), answer("sorry, retrying")]);
    expect(await createOpenAiSession(base).ask("go")).toEqual({ text: "sorry, retrying" });
    const second = calls[1]!.messages as Array<{ content?: string }>;
    expect(second.at(-1)!.content).toContain("not valid JSON");
  });

  it("hands a schema violation back rather than calling the tool with it", async () => {
    const { calls } = stubCompletions([callsTool("call_1", "echo", '{"wrong":"field"}'), answer("ok")]);
    await createOpenAiSession(base).ask("go");
    const second = calls[1]!.messages as Array<{ content?: string }>;
    expect(second.at(-1)!.content).toContain("invalid input");
  });

  it("stops after the tool-call ceiling instead of looping forever", async () => {
    const bodies = Array.from({ length: 10 }, () => callsTool("call_n", "echo", '{"text":"again"}'));
    stubCompletions(bodies);
    const result = await createOpenAiSession({ ...base, maxToolIterations: 3 }).ask("loop");
    expect(result.stoppedBecause).toBe("tool-limit");
  });

  it("reports a truncated answer rather than presenting it as complete", async () => {
    stubCompletions([{ choices: [{ message: { role: "assistant", content: "half" }, finish_reason: "length" }] }]);
    expect(await createOpenAiSession(base).ask("a long one")).toEqual({
      text: "half",
      stoppedBecause: "truncated",
      detail: "length",
    });
  });

  it("puts the server's own error body in the message", async () => {
    // A bare status code sends people to guess between a bad model name, a missing key and a
    // context overflow; the body says which.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => '{"error":{"message":"model not found"}}',
      })),
    );
    await expect(createOpenAiSession(base).ask("hi")).rejects.toThrow("model not found");
  });

  it("rolls the whole turn back when a request fails mid-exchange", async () => {
    // A `tool` message whose matching `tool_calls` never got an answer is rejected outright by
    // several of these servers, so a half-finished turn left in history poisons every later one.
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }): Promise<Record<string, unknown>> => {
        attempt++;
        if (attempt === 1) return { ok: false, status: 500, statusText: "Server Error", text: async () => "" };
        const sent = JSON.parse(init.body) as { messages: Array<{ role: string }> };
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => answer(sent.messages.map((m) => m.role).join(",")),
          text: async () => "",
        };
      }),
    );

    const session = createOpenAiSession(base);
    await expect(session.ask("first")).rejects.toThrow();
    // History is back to just the system prompt, so the second turn is system + user.
    expect(await session.ask("second")).toEqual({ text: "system,user" });
  });
});

describe("runToolByName", () => {
  it("turns an unknown tool into a message the model can read", async () => {
    expect(await runToolByName([echoTool], "nope", {})).toContain("unknown tool");
  });

  it("turns a thrown tool error into a message rather than ending the turn", async () => {
    expect(await runToolByName([explodingTool], "explode", {})).toContain("boom");
  });
});

describe("createChatSession", () => {
  it("refuses to build an Anthropic session with no key, naming the variable to set", () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createChatSession({ provider: "anthropic", system: "s", tools: [] })).toThrow(MissingApiKeyError);
      expect(() => createChatSession({ provider: "anthropic", system: "s", tools: [] })).toThrow("ANTHROPIC_API_KEY");
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("builds an OpenAI-compatible session with no key at all", () => {
    // A model served locally has no key, and demanding one would make the zero-cost way to try
    // this the one way that does not work.
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const session = createChatSession({
        provider: "openai",
        system: "s",
        tools: [],
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.1",
      });
      expect(session.describe).toContain("llama3.1");
      expect(session.describe).toContain("localhost:11434");
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });

  it("has a default model and key variable for every provider it offers", () => {
    for (const [provider, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
      expect({ provider, model: defaults.model, env: defaults.apiKeyEnv }).toMatchObject({
        model: expect.any(String),
        env: expect.stringMatching(/_API_KEY$/),
      });
      expect(isChatProvider(provider)).toBe(true);
    }
    expect(isChatProvider("gemini")).toBe(false);
  });
});
