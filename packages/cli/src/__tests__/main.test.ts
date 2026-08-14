import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

// `vi.mock` factories are hoisted above every other statement in this file (including `const`
// declarations), so the mocked fns they close over must themselves be created inside
// `vi.hoisted` — a plain top-level `const` here would be used before initialization.
const {
  runValidate,
  runGaps,
  runShadowAi,
  runPolicy,
  runTopology,
  runRender,
  runScaffold,
  runInit,
  runFmt,
  runMigrate,
  runSchema,
  runGenerate,
  runDiff,
  runApply,
  runImport,
  runServeApi,
  runServeMcp,
  runChat,
  runSlackSync,
  runPagerDutyDrift,
  runOktaDrift,
  runDoctor,
} = vi.hoisted(() => ({
  runValidate: vi.fn(async () => 0),
  runGaps: vi.fn(async () => 0),
  runShadowAi: vi.fn(async () => 0),
  runPolicy: vi.fn(async () => 0),
  runTopology: vi.fn(async () => 0),
  runRender: vi.fn(async () => 0),
  runScaffold: vi.fn(async () => 0),
  runInit: vi.fn(async () => 0),
  runFmt: vi.fn(async () => 0),
  runMigrate: vi.fn(async () => 0),
  runSchema: vi.fn(async () => 0),
  runGenerate: vi.fn(async () => 0),
  runDiff: vi.fn(async () => 0),
  runApply: vi.fn(async () => 0),
  runImport: vi.fn(async () => 0),
  runServeApi: vi.fn(async () => {}),
  runServeMcp: vi.fn(async () => {}),
  runChat: vi.fn(async () => 0),
  runSlackSync: vi.fn(async () => 0),
  runPagerDutyDrift: vi.fn(async () => 0),
  runOktaDrift: vi.fn(async () => 0),
  runDoctor: vi.fn(async () => 0),
}));

vi.mock("../commands/validate", () => ({ runValidate }));
vi.mock("../commands/gaps", () => ({ runGaps }));
vi.mock("../commands/shadow-ai", () => ({ runShadowAi }));
vi.mock("../commands/policy", () => ({ runPolicy }));
vi.mock("../commands/topology", () => ({ runTopology }));
vi.mock("../commands/render", () => ({ runRender }));
vi.mock("../commands/scaffold", () => ({ runScaffold }));
vi.mock("../commands/init", () => ({ runInit }));
vi.mock("../commands/fmt", () => ({ runFmt }));
vi.mock("../commands/migrate", () => ({ runMigrate }));
vi.mock("../commands/schema", () => ({ runSchema }));
vi.mock("../commands/generate", () => ({ runGenerate }));
vi.mock("../commands/diff", () => ({ runDiff }));
vi.mock("../commands/apply", () => ({ runApply }));
vi.mock("../commands/import", () => ({ runImport }));
vi.mock("../commands/serve-api", () => ({ runServeApi }));
vi.mock("../commands/serve-mcp", () => ({ runServeMcp }));
vi.mock("../commands/chat", () => ({ runChat }));
vi.mock("../commands/slack-sync", () => ({ runSlackSync }));
vi.mock("../commands/pagerduty-drift", () => ({ runPagerDutyDrift }));
vi.mock("../commands/okta-drift", () => ({ runOktaDrift }));
vi.mock("../commands/doctor", () => ({ runDoctor }));

// vitest hoists `vi.mock(...)` calls above every import in this file (including this one), so
// `createProgram()`'s command actions call the mocked `run*` functions above instead of touching
// the filesystem/network — this is what actually lets these tests exercise Commander's real
// argument parsing/validation/defaults in isolation.
import { createProgram } from "../main";

const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

/** A fresh, silenced, non-exiting program per test: `exitOverride` turns Commander's normal
 * `process.exit()` (on `--version`/`--help`/a validation error) into a throwable `CommanderError`
 * instead, and `configureOutput` captures what it would have printed instead of polluting the
 * test run's stdout/stderr. */
function freshProgram(): { program: Command; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => stdout.push(str),
    writeErr: (str) => stderr.push(str),
  });
  // commander subcommands don't inherit configureOutput/exitOverride automatically pre-v13; walk
  // the tree so every subcommand's own parsing failures are captured the same way.
  for (const cmd of program.commands) {
    cmd.exitOverride();
    cmd.configureOutput({
      writeOut: (str) => stdout.push(str),
      writeErr: (str) => stderr.push(str),
    });
  }
  return { program, stdout, stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProgram — top level", () => {
  it("--version reports the package's actual version, not a stale literal", async () => {
    const { program, stdout } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "--version"])).rejects.toThrow();
    expect(stdout.join("")).toContain(PACKAGE_VERSION);
  });
});

describe("createProgram — render", () => {
  it("rejects an invalid --scope before ever calling runRender", async () => {
    const { program, stderr } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "render", "some/path", "--scope", "bogus"])).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are topology, hierarchy, context-map, org-hierarchy");
    expect(runRender).not.toHaveBeenCalled();
  });

  it("passes --with-agents through, and leaves it undefined when absent", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "render", "org", "--scope", "org-hierarchy", "--with-agents"]);
    expect(runRender).toHaveBeenCalledWith(["org"], expect.objectContaining({ withAgents: true }));

    const second = freshProgram();
    await second.program.parseAsync(["node", "teamapi", "render", "org", "--scope", "org-hierarchy"]);
    expect(runRender).toHaveBeenLastCalledWith(["org"], expect.objectContaining({ withAgents: undefined }));
  });

  it("rejects an invalid --format before ever calling runRender", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "render", "some/path", "--scope", "topology", "--format", "xml"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are mermaid, dot");
    expect(runRender).not.toHaveBeenCalled();
  });

  it("defaults --format to mermaid and passes through parsed options", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "render", "some/path", "--scope", "topology"]);
    expect(runRender).toHaveBeenCalledWith(["some/path"], {
      scope: "topology",
      format: "mermaid",
      team: undefined,
      out: undefined,
    });
  });

  it("requires --scope", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "render", "some/path"])).rejects.toThrow();
    expect(runRender).not.toHaveBeenCalled();
  });
});

describe("createProgram — scaffold", () => {
  it("rejects an invalid --type before ever calling runScaffold", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "scaffold", "my-team", "--type", "bogus", "--out", "out.yml"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are stream-aligned, platform, complicated-subsystem, enabling");
    expect(runScaffold).not.toHaveBeenCalled();
  });

  it("passes through a valid --type", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "scaffold",
      "my-team",
      "--type",
      "stream-aligned",
      "--out",
      "out.yml",
    ]);
    expect(runScaffold).toHaveBeenCalledWith({
      id: "my-team",
      type: "stream-aligned",
      name: undefined,
      out: "out.yml",
    });
  });
});

describe("createProgram — policy", () => {
  it("passes the patterns straight through", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "policy", "examples/acme-org"]);
    expect(runPolicy).toHaveBeenCalledWith(["examples/acme-org"], {
      format: "text",
      config: undefined,
      noConfig: false,
    });
  });

  it("accepts no patterns, leaving the config file to supply them", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "policy"]);
    // Commander no longer rejects this; whether there are patterns to work on is decided by
    // `runPolicy`, which is the only layer that has read the config.
    expect(runPolicy).toHaveBeenCalledWith([], expect.objectContaining({ format: "text" }));
  });
});

describe("createProgram — report formats", () => {
  it.each(["validate", "gaps", "policy"])("rejects an unknown --format on %s", async (command) => {
    const { program, stderr } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", command, "org", "--format", "xml"])).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are text, json, sarif");
  });

  it("does not offer sarif on diff, which produces changes rather than findings", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "diff", "org", "--against", "main", "--format", "sarif"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are text, json");
  });
});

describe("createProgram — schema", () => {
  it("defaults --out to undefined, so the schema goes to stdout", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "schema"]);
    expect(runSchema).toHaveBeenCalledWith({ out: undefined });
  });

  it("passes --out through", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "schema", "--out", "site/schema/v1.json"]);
    expect(runSchema).toHaveBeenCalledWith({ out: "site/schema/v1.json" });
  });
});

describe("createProgram — serve-api security flags", () => {
  it("defaults to loopback with no token", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "serve-api", "org"]);
    expect(runServeApi).toHaveBeenCalledWith(
      ["org"],
      expect.objectContaining({ host: "127.0.0.1", token: undefined, allowAnonymous: undefined }),
    );
  });

  it("passes host, token, cors origins and rate limit through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "serve-api",
      "org",
      "--host",
      "0.0.0.0",
      "--token",
      "abc",
      "--cors-origin",
      "https://a.test",
      "https://b.test",
      "--rate-limit",
      "60",
    ]);
    expect(runServeApi).toHaveBeenCalledWith(
      ["org"],
      expect.objectContaining({
        host: "0.0.0.0",
        token: "abc",
        corsOrigin: ["https://a.test", "https://b.test"],
        rateLimit: 60,
      }),
    );
  });

  it("rejects a non-numeric --rate-limit before ever calling runServeApi", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "serve-api", "org", "--rate-limit", "lots"])).rejects.toThrow();
    expect(runServeApi).not.toHaveBeenCalled();
  });

  it("rejects a zero --rate-limit, which would otherwise silently block every request", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "serve-api", "org", "--rate-limit", "0"])).rejects.toThrow();
    expect(runServeApi).not.toHaveBeenCalled();
  });
});

describe("createProgram — serve-api", () => {
  it("rejects a non-numeric --port before ever calling runServeApi", async () => {
    const { program, stderr } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "abc"])).rejects.toThrow();
    expect(stderr.join("")).toContain("must be an integer between 1 and 65535");
    expect(runServeApi).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range --port", async () => {
    const { program } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "99999"]),
    ).rejects.toThrow();
    expect(runServeApi).not.toHaveBeenCalled();
  });

  it("rejects a negative --port", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "-1"])).rejects.toThrow();
    expect(runServeApi).not.toHaveBeenCalled();
  });

  it("parses --port to a number and defaults to 3000", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "serve-api", "some/path"]);
    expect(runServeApi).toHaveBeenCalledWith(["some/path"], expect.objectContaining({ port: 3000 }));

    await program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "4000"]);
    expect(runServeApi).toHaveBeenCalledWith(["some/path"], expect.objectContaining({ port: 4000 }));
  });
});

describe("createProgram — generate", () => {
  it("rejects an unknown generate target before ever calling runGenerate", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "generate", "not-a-target", "some/path", "--out", "out"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain(
      "Allowed choices are crewai, backstage, paperclip, codeowners, agents-md, port, otel",
    );
    expect(runGenerate).not.toHaveBeenCalled();
  });

  it("accepts the crewai target", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "generate", "crewai", "some/path", "--out", "out"]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], { target: "crewai", team: undefined, out: "out" });
  });

  it("accepts the backstage target", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "generate", "backstage", "some/path", "--out", "out"]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], { target: "backstage", team: undefined, out: "out" });
  });

  it("accepts the otel target", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "generate", "otel", "some/path", "--out", "out"]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], {
      target: "otel",
      team: undefined,
      out: "out",
      company: undefined,
      org: undefined,
    });
  });

  it("accepts the port target", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "generate", "port", "some/path", "--out", "out"]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], {
      target: "port",
      team: undefined,
      out: "out",
      company: undefined,
      org: undefined,
    });
  });

  it("accepts the agents-md target", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "generate", "agents-md", "some/path", "--out", "out"]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], {
      target: "agents-md",
      team: undefined,
      out: "out",
      company: undefined,
      org: undefined,
    });
  });

  it("accepts the codeowners target and passes --org through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "generate",
      "codeowners",
      "some/path",
      "--out",
      "out",
      "--org",
      "acme",
    ]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], {
      target: "codeowners",
      team: undefined,
      out: "out",
      company: undefined,
      org: "acme",
    });
  });

  it("accepts the paperclip target and passes --company through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "generate",
      "paperclip",
      "some/path",
      "--out",
      "out",
      "--company",
      "ACME Org",
    ]);
    expect(runGenerate).toHaveBeenCalledWith(["some/path"], {
      target: "paperclip",
      team: undefined,
      out: "out",
      company: "ACME Org",
    });
  });
});

describe("createProgram — diff", () => {
  it("requires --against", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "diff", "some/path"])).rejects.toThrow();
    expect(runDiff).not.toHaveBeenCalled();
  });

  it("passes patterns and --against through to runDiff", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "diff", "some/path", "--against", "main"]);
    expect(runDiff).toHaveBeenCalledWith(["some/path"], { against: "main", format: "text" });
  });
});

describe("createProgram — apply", () => {
  it("accepts no --org, leaving defaults.github.org to supply it", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "apply", "some/path"]);
    expect(runApply).toHaveBeenCalledWith(["some/path"], expect.objectContaining({ org: undefined }));
  });

  it("passes patterns, --org, --token, and --yes through to runApply", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "apply", "some/path", "--org", "acme", "--token", "t", "--yes"]);
    expect(runApply).toHaveBeenCalledWith(["some/path"], { org: "acme", token: "t", yes: true });
  });

  it("defaults --token and --yes to undefined", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "apply", "some/path", "--org", "acme"]);
    expect(runApply).toHaveBeenCalledWith(["some/path"], { org: "acme", token: undefined, yes: undefined });
  });
});

describe("createProgram — import", () => {
  it("only accepts github-org as a source", async () => {
    const { program } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "import", "slack-org", "acme", "--out", "out"]),
    ).rejects.toThrow();
    expect(runImport).not.toHaveBeenCalled();
  });

  it("requires --out", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "import", "github-org", "acme"])).rejects.toThrow();
    expect(runImport).not.toHaveBeenCalled();
  });

  it("passes source, org, --token, and --out through to runImport", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "import", "github-org", "acme", "--token", "t", "--out", "out"]);
    expect(runImport).toHaveBeenCalledWith("github-org", "acme", { token: "t", out: "out" });
  });
});

describe("createProgram — chat", () => {
  it("defaults to the anthropic provider and leaves the model to it", async () => {
    // No `--model` default here on purpose: the right default depends on which provider was
    // chosen, and a shared constant would have sent an Anthropic model id to an OpenAI endpoint.
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "chat", "some/path", "--team", "stream-checkout"]);
    expect(runChat).toHaveBeenCalledWith(["some/path"], {
      team: "stream-checkout",
      member: undefined,
      provider: "anthropic",
      model: undefined,
      apiKey: undefined,
      baseUrl: undefined,
      ask: undefined,
      quiet: undefined,
      debug: undefined,
    });
  });

  it("passes provider, base URL and the one-shot question through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "chat",
      "some/path",
      "--team",
      "stream-checkout",
      "--provider",
      "openai",
      "--base-url",
      "http://localhost:11434/v1",
      "--model",
      "llama3.1",
      "--ask",
      "who owns checkout-api?",
      "--quiet",
    ]);
    expect(runChat).toHaveBeenCalledWith(["some/path"], {
      team: "stream-checkout",
      member: undefined,
      provider: "openai",
      model: "llama3.1",
      apiKey: undefined,
      baseUrl: "http://localhost:11434/v1",
      ask: "who owns checkout-api?",
      quiet: true,
      debug: undefined,
    });
  });

  it("rejects an unknown provider rather than falling back to a default", async () => {
    const { program } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "chat", "p", "--team", "t", "--provider", "gemini"]),
    ).rejects.toThrow();
    expect(runChat).not.toHaveBeenCalled();
  });

  it("requires --team", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "chat", "some/path"])).rejects.toThrow();
    expect(runChat).not.toHaveBeenCalled();
  });
});

describe("createProgram — slack-sync", () => {
  it("passes --token and --yes through, defaulting both to undefined", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "slack-sync", "some/path"]);
    expect(runSlackSync).toHaveBeenCalledWith(["some/path"], { token: undefined, yes: undefined });

    await program.parseAsync(["node", "teamapi", "slack-sync", "some/path", "--token", "t", "--yes"]);
    expect(runSlackSync).toHaveBeenCalledWith(["some/path"], { token: "t", yes: true });
  });
});

describe("createProgram — pagerduty-drift", () => {
  it("passes --token and --url through, defaulting both to undefined", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "pagerduty-drift", "some/path"]);
    expect(runPagerDutyDrift).toHaveBeenCalledWith(["some/path"], { token: undefined, url: undefined });

    await program.parseAsync([
      "node",
      "teamapi",
      "pagerduty-drift",
      "some/path",
      "--token",
      "t",
      "--url",
      "https://eu.pagerduty.com",
    ]);
    expect(runPagerDutyDrift).toHaveBeenCalledWith(["some/path"], { token: "t", url: "https://eu.pagerduty.com" });
  });
});

describe("createProgram — okta-drift", () => {
  it("accepts no --url, leaving defaults.okta.url to supply it", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "okta-drift", "some/path"]);
    expect(runOktaDrift).toHaveBeenCalledWith(["some/path"], expect.objectContaining({ url: undefined }));
  });

  it("passes --url, --token and --group-prefix through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "okta-drift",
      "some/path",
      "--url",
      "https://acme.okta.com",
      "--token",
      "t",
      "--group-prefix",
      "eng-",
    ]);
    expect(runOktaDrift).toHaveBeenCalledWith(["some/path"], {
      url: "https://acme.okta.com",
      token: "t",
      groupPrefix: "eng-",
    });
  });
});

describe("createProgram — doctor", () => {
  it("rejects an unknown integration before ever calling runDoctor", async () => {
    const { program, stderr } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "doctor", "jira"])).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are github, slack, pagerduty, okta, paperclip");
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it("passes the integration and its options through", async () => {
    const okta = freshProgram();
    await okta.program.parseAsync([
      "node",
      "teamapi",
      "doctor",
      "okta",
      "--url",
      "https://acme.okta.com",
      "--token",
      "t",
    ]);
    expect(runDoctor).toHaveBeenCalledWith("okta", { token: "t", url: "https://acme.okta.com", org: undefined });

    // a fresh program per parse: commander keeps option state on the subcommand instance
    const github = freshProgram();
    await github.program.parseAsync(["node", "teamapi", "doctor", "github", "--org", "acme"]);
    expect(runDoctor).toHaveBeenCalledWith("github", { token: undefined, url: undefined, org: "acme" });
  });
});

describe("createProgram — validate", () => {
  it("passes patterns straight through to runValidate", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "validate", "a", "b"]);
    expect(runValidate).toHaveBeenCalledWith(["a", "b"], { format: "text", config: undefined, noConfig: false });
  });
});

describe("createProgram — gaps", () => {
  it("passes patterns straight through to runGaps", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "gaps", "a", "b"]);
    expect(runGaps).toHaveBeenCalledWith(["a", "b"], { format: "text", config: undefined, noConfig: false });
  });

  it("accepts no patterns, leaving the config file to supply them", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "gaps"]);
    expect(runGaps).toHaveBeenCalledWith([], expect.objectContaining({ format: "text" }));
  });
});

describe("createProgram — shadow-ai", () => {
  it("passes patterns and --scan through to runShadowAi", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "shadow-ai", "org", "--scan", "./repos"]);
    expect(runShadowAi).toHaveBeenCalledWith(["org"], {
      scan: "./repos",
      format: "text",
      config: undefined,
      noConfig: false,
    });
  });

  it("requires --scan", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "shadow-ai", "org"])).rejects.toThrow();
  });
});

describe("createProgram — gaps config flags", () => {
  it("passes --config through as a path", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "gaps", "org", "--config", "custom.yml"]);
    expect(runGaps).toHaveBeenCalledWith(["org"], expect.objectContaining({ config: "custom.yml", noConfig: false }));
  });

  it("turns --no-config into noConfig, not into a config path of 'false'", async () => {
    // Commander writes both flags to the same key; untangling them wrongly would make
    // `--no-config` look like `--config false` and try to read a file by that name.
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "gaps", "org", "--no-config"]);
    expect(runGaps).toHaveBeenCalledWith(["org"], expect.objectContaining({ config: undefined, noConfig: true }));
  });
});

describe("createProgram — topology", () => {
  it("passes patterns and defaults through", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "topology", "org"]);
    expect(runTopology).toHaveBeenCalledWith(["org"], { format: "text", config: undefined, noConfig: false });
  });

  it("rejects an unknown --format", async () => {
    const { program, stderr } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "topology", "org", "--format", "xml"])).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are text, json, sarif");
  });
});

describe("createProgram — init", () => {
  it("defaults to the current directory and the teams/ layout", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "init"]);
    expect(runInit).toHaveBeenCalledWith({ dir: ".", teamsDir: "teams", teams: undefined, force: undefined });
  });

  it("passes a directory, --teams-dir, repeated --team and --force through", async () => {
    const { program } = freshProgram();
    await program.parseAsync([
      "node",
      "teamapi",
      "init",
      "new-org",
      "--teams-dir",
      "org",
      "--team",
      "checkout",
      "billing",
      "--force",
    ]);
    expect(runInit).toHaveBeenCalledWith({
      dir: "new-org",
      teamsDir: "org",
      teams: ["checkout", "billing"],
      force: true,
    });
  });
});

describe("createProgram — fmt", () => {
  it("defaults to writing, with patterns from the config", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "fmt"]);
    expect(runFmt).toHaveBeenCalledWith([], { check: undefined, config: undefined, noConfig: false });
  });

  it("passes --check through", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "fmt", "org", "--check"]);
    expect(runFmt).toHaveBeenCalledWith(["org"], expect.objectContaining({ check: true }));
  });
});

describe("createProgram — migrate", () => {
  it("defaults to writing, with patterns from the config", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "migrate"]);
    expect(runMigrate).toHaveBeenCalledWith([], { check: undefined, config: undefined, noConfig: false });
  });

  it("passes --check through", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "migrate", "org", "--check"]);
    expect(runMigrate).toHaveBeenCalledWith(["org"], expect.objectContaining({ check: true }));
  });
});
