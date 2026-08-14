import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { AnyChatTool } from "../tool";

const { toolRunnerMock, ctorMock } = vi.hoisted(() => ({ toolRunnerMock: vi.fn(), ctorMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: ctorMock.mockImplementation(() => ({ beta: { messages: { toolRunner: toolRunnerMock } } })),
}));

import { createAnthropicSession, DEFAULT_ANTHROPIC_MODEL } from "../providers/anthropic";

const echoTool: AnyChatTool = {
  name: "echo",
  description: "Echoes its input.",
  inputSchema: z.object({ text: z.string() }),
  run: async (input) => `echoed: ${(input as { text: string }).text}`,
};

const base = { apiKey: "sk-ant-test", system: "You are a team.", tools: [echoTool], model: DEFAULT_ANTHROPIC_MODEL };

function reply(text: string, stop_reason: string) {
  return { content: text ? [{ type: "text", text }] : [], stop_reason };
}

beforeEach(() => {
  toolRunnerMock.mockReset();
  ctorMock.mockClear();
});

describe("createAnthropicSession", () => {
  it("passes the persona, tools and iteration cap to the SDK's tool runner", async () => {
    toolRunnerMock.mockResolvedValueOnce(reply("hello", "end_turn"));
    const session = createAnthropicSession({ ...base, maxToolIterations: 7 });

    expect(await session.ask("hi")).toEqual({ text: "hello" });
    expect(ctorMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });

    const call = toolRunnerMock.mock.calls[0]![0];
    expect(call.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(call.max_iterations).toBe(7);
    expect(call.system).toBe("You are a team.");
    expect(call.tools).toHaveLength(1);
    // The SDK executes the tool itself, so the loop is its problem rather than a second
    // implementation of one here.
    expect(call.tools[0].name).toBe("echo");
    // The converted tool still runs the original implementation — the conversion is a wrapper,
    // and a wrapper that dropped the body would look identical from the outside until a model
    // called it.
    expect(await call.tools[0].run({ text: "x" })).toBe("echoed: x");
    expect(call.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("only passes a base URL when one was given", async () => {
    toolRunnerMock.mockResolvedValue(reply("ok", "end_turn"));
    await createAnthropicSession(base).ask("hi");
    expect(ctorMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });

    await createAnthropicSession({ ...base, baseUrl: "https://gateway.example.com" }).ask("hi");
    expect(ctorMock).toHaveBeenLastCalledWith({ apiKey: "sk-ant-test", baseURL: "https://gateway.example.com" });
  });

  it("carries history across turns", async () => {
    toolRunnerMock.mockResolvedValueOnce(reply("first", "end_turn")).mockResolvedValueOnce(reply("second", "end_turn"));
    const session = createAnthropicSession(base);
    await session.ask("one");
    await session.ask("two");

    // The array handed to the SDK is the same object the session keeps mutating, so by the time
    // this reads it the second reply has been appended too. Assert the order, which is the part
    // that matters, rather than a length that depends on when you look.
    const messages = toolRunnerMock.mock.calls[1]![0].messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0]).toEqual({ role: "user", content: "one" });
    expect(messages[2]).toEqual({ role: "user", content: "two" });
  });

  it("drops the failed question from history instead of asking it twice", async () => {
    toolRunnerMock.mockRejectedValueOnce(new Error("rate limited")).mockResolvedValueOnce(reply("ok", "end_turn"));
    const session = createAnthropicSession(base);

    await expect(session.ask("first")).rejects.toThrow("rate limited");
    await session.ask("second");
    // "first" is gone entirely: retrying with it still in history would ask the same question
    // twice. Same shared-array caveat as above, so this reads the first message rather than all.
    const messages = toolRunnerMock.mock.calls[1]![0].messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({ role: "user", content: "second" });
  });

  it.each([
    ["tool_use", "tool-limit"],
    ["refusal", "refusal"],
    ["max_tokens", "truncated"],
  ])("reports stop_reason=%s as %s rather than a finished answer", async (stopReason, expected) => {
    // A 200 does not mean a complete answer: the tool runner returns whatever the last message
    // was even when it stopped for a reason other than finishing.
    toolRunnerMock.mockResolvedValueOnce(reply("partial", stopReason));
    expect((await createAnthropicSession(base).ask("q")).stoppedBecause).toBe(expected);
  });

  it("treats a stop sequence as a finished answer", async () => {
    toolRunnerMock.mockResolvedValueOnce(reply("done", "stop_sequence"));
    expect(await createAnthropicSession(base).ask("q")).toEqual({ text: "done" });
  });

  it("joins multiple text blocks and ignores non-text ones", async () => {
    toolRunnerMock.mockResolvedValueOnce({
      content: [
        { type: "text", text: "one" },
        { type: "tool_use", id: "t", name: "echo", input: {} },
        { type: "text", text: "two" },
      ],
      stop_reason: "end_turn",
    });
    expect((await createAnthropicSession(base).ask("q")).text).toBe("one\ntwo");
  });
});
