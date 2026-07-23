import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

// `vi.mock` factories are hoisted above every other statement (including `const`), so the mocked
// fns they close over must themselves be created inside `vi.hoisted`.
const { toolRunnerMock, anthropicCtorMock, questionMock, closeMock, createInterfaceMock } = vi.hoisted(() => ({
  toolRunnerMock: vi.fn(),
  anthropicCtorMock: vi.fn(),
  questionMock: vi.fn(),
  closeMock: vi.fn(),
  createInterfaceMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: anthropicCtorMock.mockImplementation(() => ({
    beta: { messages: { toolRunner: toolRunnerMock } },
  })),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: createInterfaceMock.mockImplementation(() => ({
    question: questionMock,
    close: closeMock,
  })),
}));

import { indentContinuationLines, prettyToolOutput, runChat } from "../commands/chat";

describe("prettyToolOutput", () => {
  it("re-formats valid JSON from scratch", () => {
    expect(prettyToolOutput('{"a":1,"b":[1,2]}')).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2));
  });

  it("leaves non-JSON output (e.g. a rendered diagram) untouched", () => {
    expect(prettyToolOutput("flowchart LR\n  a --> b")).toBe("flowchart LR\n  a --> b");
  });
});

describe("indentContinuationLines", () => {
  it("leaves the first line alone and indents every subsequent line", () => {
    expect(indentContinuationLines("a\nb\nc", "  ")).toBe("a\n  b\n  c");
  });

  it("is a no-op for single-line text", () => {
    expect(indentContinuationLines("just one line", "    ")).toBe("just one line");
  });
});

describe("runChat", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    toolRunnerMock.mockReset();
    questionMock.mockReset();
    closeMock.mockReset();
    anthropicCtorMock.mockClear();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns 1 when no files match", async () => {
    const exitCode = await runChat(["/tmp/does-not-exist-*.yml"], { team: "stream-checkout" });
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No files matched"));
  });

  it("returns 1 with a clear message when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const exitCode = await runChat([CHECKOUT_SEED], { team: "stream-checkout" });
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY is not set"));
    expect(anthropicCtorMock).not.toHaveBeenCalled();
  });

  it("returns 1 for an unknown team id", async () => {
    const exitCode = await runChat([CHECKOUT_SEED], { team: "does-not-exist" });
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown team id"));
  });

  it("returns 1 for an unknown member id on a known team", async () => {
    const exitCode = await runChat([CHECKOUT_SEED], { team: "stream-checkout", member: "does-not-exist" });
    expect(exitCode).toBe(1);
  });

  it("runs a single turn end-to-end: sends the persona/model/tools/iteration-cap and prints the reply", async () => {
    questionMock.mockResolvedValueOnce("what's up").mockRejectedValueOnce(new Error("EOF"));
    toolRunnerMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "All good here." }],
      stop_reason: "end_turn",
    });

    const exitCode = await runChat([CHECKOUT_SEED], { team: "stream-checkout" });

    expect(exitCode).toBe(0);
    expect(anthropicCtorMock).toHaveBeenCalledWith({ apiKey: "sk-ant-test-key" });
    expect(toolRunnerMock).toHaveBeenCalledTimes(1);
    const call = toolRunnerMock.mock.calls[0]![0];
    expect(call.model).toBe("claude-opus-4-8");
    expect(call.max_iterations).toBe(20);
    expect(call.system).toEqual(expect.stringContaining("Stream Checkout"));
    // `call.messages` is the same array object `runChat` keeps mutating, so by the time we
    // inspect it here it also holds the assistant reply pushed *after* this call — assert on
    // what was true at call time (the user's message present at index 0), not array length.
    expect(call.messages[0]).toEqual({ role: "user", content: "what's up" });
    expect(closeMock).toHaveBeenCalled();

    const printedReply = logSpy.mock.calls.some((args) => String(args[0]).includes("All good here."));
    expect(printedReply).toBe(true);
  });

  it("surfaces stop_reason='tool_use' as hitting the iteration limit, not a silent truncation", async () => {
    questionMock.mockResolvedValueOnce("keep digging").mockRejectedValueOnce(new Error("EOF"));
    toolRunnerMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "partial answer" }],
      stop_reason: "tool_use",
    });

    await runChat([CHECKOUT_SEED], { team: "stream-checkout" });

    const warned = logSpy.mock.calls.some((args) => String(args[0]).includes("tool-call limit"));
    expect(warned).toBe(true);
  });

  it("surfaces stop_reason='refusal' distinctly instead of printing empty text", async () => {
    questionMock.mockResolvedValueOnce("a refused question").mockRejectedValueOnce(new Error("EOF"));
    toolRunnerMock.mockResolvedValueOnce({ content: [], stop_reason: "refusal" });

    await runChat([CHECKOUT_SEED], { team: "stream-checkout" });

    const warned = logSpy.mock.calls.some((args) => String(args[0]).includes("withheld"));
    expect(warned).toBe(true);
  });

  it("surfaces an unusual stop_reason (e.g. max_tokens) instead of silently printing a truncated reply", async () => {
    questionMock.mockResolvedValueOnce("a long question").mockRejectedValueOnce(new Error("EOF"));
    toolRunnerMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "truncated..." }],
      stop_reason: "max_tokens",
    });

    await runChat([CHECKOUT_SEED], { team: "stream-checkout" });

    const warned = logSpy.mock.calls.some((args) => String(args[0]).includes("stop_reason=max_tokens"));
    expect(warned).toBe(true);
  });

  it("recovers from a toolRunner rejection instead of crashing the session", async () => {
    questionMock
      .mockResolvedValueOnce("this call fails")
      .mockResolvedValueOnce("exit");
    toolRunnerMock.mockRejectedValueOnce(new Error("rate limited"));

    const exitCode = await runChat([CHECKOUT_SEED], { team: "stream-checkout" });

    expect(exitCode).toBe(0);
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("rate limited"))).toBe(true);
  });
});
