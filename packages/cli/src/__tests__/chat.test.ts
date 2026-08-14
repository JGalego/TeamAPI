import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

// `vi.mock` factories are hoisted above every other statement (including `const`), so the mocked
// fns they close over must themselves be created inside `vi.hoisted`.
const { askMock, createChatSessionMock, questionMock, closeMock, createInterfaceMock } = vi.hoisted(() => ({
  askMock: vi.fn(),
  createChatSessionMock: vi.fn(),
  questionMock: vi.fn(),
  closeMock: vi.fn(),
  createInterfaceMock: vi.fn(),
}));

// The seam is the chat package's session factory, not the vendor SDK underneath it. Mocking
// `@anthropic-ai/sdk` here would test that one provider's wiring and say nothing about the other;
// the adapters have their own tests, where the provider is the subject rather than an
// implementation detail of the command.
vi.mock("@jgalego/teamapi-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jgalego/teamapi-chat")>()),
  createChatSession: createChatSessionMock.mockImplementation(() => ({
    describe: "fake (test-model)",
    ask: askMock,
  })),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: createInterfaceMock.mockImplementation(() => ({
    question: questionMock,
    close: closeMock,
  })),
}));

import { indentContinuationLines, prettyToolOutput, runChat, stopNote } from "../commands/chat";

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

describe("stopNote", () => {
  it("explains each way a turn can end other than finishing", () => {
    expect(stopNote({ text: "", stoppedBecause: "tool-limit" }, 20)).toContain("20-tool-call limit");
    expect(stopNote({ text: "", stoppedBecause: "refusal" }, 20)).toContain("withheld");
    expect(stopNote({ text: "", stoppedBecause: "truncated", detail: "length" }, 20)).toContain("length");
  });

  it("says nothing about a turn that finished", () => {
    expect(stopNote({ text: "done" }, 20)).toBeUndefined();
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
    askMock.mockReset();
    questionMock.mockReset();
    closeMock.mockReset();
    createChatSessionMock.mockClear();
    createInterfaceMock.mockClear();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const logged = (needle: string): boolean => logSpy.mock.calls.some((args) => String(args[0]).includes(needle));
  const errored = (needle: string): boolean => errorSpy.mock.calls.some((args) => String(args[0]).includes(needle));

  it("returns 1 when no files match", async () => {
    expect(await runChat(["/tmp/does-not-exist-*.yml"], { team: "stream-checkout" })).toBe(1);
    expect(errored("No files matched")).toBe(true);
  });

  it("returns 1 for an unknown team id", async () => {
    expect(await runChat([CHECKOUT_SEED], { team: "does-not-exist" })).toBe(1);
    expect(errored("Unknown team id")).toBe(true);
  });

  it("returns 1 for an unknown member id on a known team", async () => {
    expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout", member: "does-not-exist" })).toBe(1);
  });

  it("names the environment variable when the provider has no key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    createChatSessionMock.mockImplementationOnce(() => {
      throw Object.assign(new Error("No API key for provider 'anthropic'. Set ANTHROPIC_API_KEY, or pass --api-key."), {
        name: "MissingApiKeyError",
      });
    });
    // The real MissingApiKeyError is thrown by the real factory; here the mock stands in for it,
    // so the assertion is on the message reaching the user rather than on the class.
    await expect(runChat([CHECKOUT_SEED], { team: "stream-checkout" })).rejects.toThrow("No API key");
  });

  it("passes the persona, the tools and the chosen provider to the session factory", async () => {
    questionMock.mockRejectedValueOnce(new Error("EOF"));
    await runChat([CHECKOUT_SEED], { team: "stream-checkout", provider: "openai", baseUrl: "http://x/v1" });

    const call = createChatSessionMock.mock.calls[0]![0];
    expect(call.provider).toBe("openai");
    expect(call.baseUrl).toBe("http://x/v1");
    expect(call.maxToolIterations).toBe(20);
    expect(call.system).toEqual(expect.stringContaining("Stream Checkout"));
    expect(call.tools.map((tool: { name: string }) => tool.name)).toContain("find_service_owner");
  });

  it("runs an interactive turn and prints the reply", async () => {
    questionMock.mockResolvedValueOnce("what's up").mockRejectedValueOnce(new Error("EOF"));
    askMock.mockResolvedValueOnce({ text: "All good here." });

    expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout" })).toBe(0);
    expect(askMock).toHaveBeenCalledWith("what's up");
    expect(logged("All good here.")).toBe(true);
    expect(closeMock).toHaveBeenCalled();
  });

  it("keeps the session alive when a turn throws", async () => {
    questionMock.mockResolvedValueOnce("this call fails").mockResolvedValueOnce("exit");
    askMock.mockRejectedValueOnce(new Error("rate limited"));

    expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout" })).toBe(0);
    expect(errored("rate limited")).toBe(true);
  });

  it("surfaces a turn that stopped early rather than printing it as a complete answer", async () => {
    questionMock.mockResolvedValueOnce("keep digging").mockRejectedValueOnce(new Error("EOF"));
    askMock.mockResolvedValueOnce({ text: "partial", stoppedBecause: "tool-limit" });

    await runChat([CHECKOUT_SEED], { team: "stream-checkout" });
    expect(logged("tool-call limit")).toBe(true);
  });

  describe("--ask", () => {
    it("prints only the answer on stdout, and everything else on stderr", async () => {
      askMock.mockResolvedValueOnce({ text: "Stream Checkout owns it." });

      expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout", ask: "who owns checkout-api?" })).toBe(0);
      expect(askMock).toHaveBeenCalledWith("who owns checkout-api?");
      // The whole point of the mode: `teamapi chat ... --ask ... | jq` has to work, so stdout is
      // exactly the answer and the banner goes to the other stream.
      expect(logSpy.mock.calls).toEqual([["Stream Checkout owns it."]]);
      expect(errored("Asking Stream Checkout")).toBe(true);
      // No prompt, no readline: this mode never touches stdin.
      expect(createInterfaceMock).not.toHaveBeenCalled();
    });

    it("prints nothing but the answer with --quiet", async () => {
      askMock.mockResolvedValueOnce({ text: "42" });
      expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout", ask: "how many?", quiet: true })).toBe(0);
      expect(logSpy.mock.calls).toEqual([["42"]]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("exits 2 when the answer is incomplete", async () => {
      // A truncated answer exiting 0 is a script silently acting on half a reply — the failure
      // this mode is most likely to cause and least likely to notice.
      askMock.mockResolvedValueOnce({ text: "half an ans", stoppedBecause: "tool-limit" });
      expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout", ask: "a big question" })).toBe(2);
      expect(logSpy.mock.calls).toEqual([["half an ans"]]);
    });

    it("exits 1 when the provider fails", async () => {
      askMock.mockRejectedValueOnce(new Error("rate limited"));
      expect(await runChat([CHECKOUT_SEED], { team: "stream-checkout", ask: "anything" })).toBe(1);
      expect(errored("rate limited")).toBe(true);
    });
  });
});
