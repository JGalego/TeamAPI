import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";

// `vi.mock` factories are hoisted above every other statement in this file (including `const`
// declarations), so the mocked fns they close over must themselves be created inside
// `vi.hoisted` — a plain top-level `const` here would be used before initialization.
const { runValidate, runRender, runScaffold, runGenerate, runDiff, runServeApi, runServeMcp, runChat } = vi.hoisted(
  () => ({
    runValidate: vi.fn(async () => 0),
    runRender: vi.fn(async () => 0),
    runScaffold: vi.fn(async () => 0),
    runGenerate: vi.fn(async () => 0),
    runDiff: vi.fn(async () => 0),
    runServeApi: vi.fn(async () => {}),
    runServeMcp: vi.fn(async () => {}),
    runChat: vi.fn(async () => 0),
  }),
);

vi.mock("../commands/validate", () => ({ runValidate }));
vi.mock("../commands/render", () => ({ runRender }));
vi.mock("../commands/scaffold", () => ({ runScaffold }));
vi.mock("../commands/generate", () => ({ runGenerate }));
vi.mock("../commands/diff", () => ({ runDiff }));
vi.mock("../commands/serve-api", () => ({ runServeApi }));
vi.mock("../commands/serve-mcp", () => ({ runServeMcp }));
vi.mock("../commands/chat", () => ({ runChat }));

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
    await expect(
      program.parseAsync(["node", "teamapi", "render", "some/path", "--scope", "bogus"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are topology, hierarchy, context-map, org-hierarchy");
    expect(runRender).not.toHaveBeenCalled();
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
    expect(stderr.join("")).toContain(
      "Allowed choices are stream-aligned, platform, complicated-subsystem, enabling",
    );
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
    expect(runScaffold).toHaveBeenCalledWith({ id: "my-team", type: "stream-aligned", name: undefined, out: "out.yml" });
  });
});

describe("createProgram — serve-api", () => {
  it("rejects a non-numeric --port before ever calling runServeApi", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "abc"]),
    ).rejects.toThrow();
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
    await expect(
      program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "-1"]),
    ).rejects.toThrow();
    expect(runServeApi).not.toHaveBeenCalled();
  });

  it("parses --port to a number and defaults to 3000", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "serve-api", "some/path"]);
    expect(runServeApi).toHaveBeenCalledWith(["some/path"], { port: 3000 });

    await program.parseAsync(["node", "teamapi", "serve-api", "some/path", "--port", "4000"]);
    expect(runServeApi).toHaveBeenCalledWith(["some/path"], { port: 4000 });
  });
});

describe("createProgram — generate", () => {
  it("rejects an unknown generate target before ever calling runGenerate", async () => {
    const { program, stderr } = freshProgram();
    await expect(
      program.parseAsync(["node", "teamapi", "generate", "not-a-target", "some/path", "--out", "out"]),
    ).rejects.toThrow();
    expect(stderr.join("")).toContain("Allowed choices are crewai, backstage");
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
    expect(runDiff).toHaveBeenCalledWith(["some/path"], { against: "main" });
  });
});

describe("createProgram — chat", () => {
  it("uses the shared DEFAULT_CHAT_MODEL as the --model default", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "chat", "some/path", "--team", "stream-checkout"]);
    expect(runChat).toHaveBeenCalledWith(["some/path"], {
      team: "stream-checkout",
      member: undefined,
      model: "claude-opus-4-8",
      debug: undefined,
    });
  });

  it("requires --team", async () => {
    const { program } = freshProgram();
    await expect(program.parseAsync(["node", "teamapi", "chat", "some/path"])).rejects.toThrow();
    expect(runChat).not.toHaveBeenCalled();
  });
});

describe("createProgram — validate", () => {
  it("passes patterns straight through to runValidate", async () => {
    const { program } = freshProgram();
    await program.parseAsync(["node", "teamapi", "validate", "a", "b"]);
    expect(runValidate).toHaveBeenCalledWith(["a", "b"]);
  });
});
