import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runApply } from "../commands/apply";
import { runOktaDrift } from "../commands/okta-drift";
import { runPaperclipDrift } from "../commands/paperclip-drift";
import { runValidate } from "../commands/validate";
import { runServeApi } from "../commands/serve-api";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-defaults-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeConfig(body: string) {
  const file = path.join(tmpDir, "teamapi.config.yml");
  await fs.writeFile(file, body, "utf-8");
  return file;
}

/** Reads back what a command actually printed, so these assert the message a user sees. */
function stderr(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.map(String).join(" "))
    .join("\n");
}

describe("patterns from config", () => {
  it("lets a command run with no patterns at all", async () => {
    const config = await writeConfig(`patterns: ["${ACME_ROOT}"]\n`);
    expect(await runValidate([], { config })).toBe(0);
  });

  it("fails with a message naming both ways to supply them", async () => {
    const config = await writeConfig("patterns: []\n");
    expect(await runValidate([], { config })).toBe(1);
    expect(stderr()).toContain("teamapi.config.yml");
  });

  it("reports a broken config rather than resolving anything", async () => {
    const config = await writeConfig("nonsense: true\n");
    expect(await runValidate([ACME_ROOT], { config })).toBe(1);
    expect(stderr()).toContain("Unrecognized");
  });

  it("ignores the config entirely under --no-config", async () => {
    // Even a config that would have supplied patterns.
    await writeConfig(`patterns: ["${ACME_ROOT}"]\n`);
    expect(await runValidate([], { noConfig: true })).toBe(1);
    expect(stderr()).toContain("No patterns given");
  });
});

describe("defaults.github.org", () => {
  it("is required when neither flag nor config supplies it", async () => {
    const config = await writeConfig("defaults: {}\n");
    expect(await runApply([ACME_ROOT], { config })).toBe(1);
    expect(stderr()).toContain("defaults.github.org");
  });

  it("gets past the org check once the config supplies it", async () => {
    const config = await writeConfig("defaults:\n  github:\n    org: acme\n");
    // No token in the environment, so it stops at the *next* gate — which proves the org one
    // passed, without this test needing to reach GitHub.
    const previous = { token: process.env.GITHUB_TOKEN, gh: process.env.GH_TOKEN };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      expect(await runApply([ACME_ROOT], { config })).toBe(1);
      expect(stderr()).toContain("GitHub token");
    } finally {
      if (previous.token) process.env.GITHUB_TOKEN = previous.token;
      if (previous.gh) process.env.GH_TOKEN = previous.gh;
    }
  });
});

describe("defaults.okta.url", () => {
  it("is required when neither flag nor config supplies it", async () => {
    const config = await writeConfig("defaults: {}\n");
    expect(await runOktaDrift([ACME_ROOT], { config })).toBe(1);
    expect(stderr()).toContain("defaults.okta.url");
  });
});

describe("defaults.paperclip", () => {
  it("is required when neither flag nor config supplies it", async () => {
    const config = await writeConfig("defaults: {}\n");
    expect(await runPaperclipDrift([ACME_ROOT], { config })).toBe(1);
    expect(stderr()).toContain("defaults.paperclip");
  });

  it("still fails when only half of it is configured", async () => {
    const config = await writeConfig("defaults:\n  paperclip:\n    url: http://localhost:3000\n");
    expect(await runPaperclipDrift([ACME_ROOT], { config })).toBe(1);
  });
});

describe("defaults.serve", () => {
  it("refuses a configured non-loopback host with no token, exactly as the flag would", async () => {
    // The safety check has to see the resolved host, not just the one typed on the command line.
    const config = await writeConfig(`patterns: ["${ACME_ROOT}"]\ndefaults:\n  serve:\n    host: 0.0.0.0\n`);
    const previous = process.env.TEAMAPI_API_TOKEN;
    delete process.env.TEAMAPI_API_TOKEN;
    try {
      await expect(runServeApi([], { config })).rejects.toThrow(/Refusing to listen on 0\.0\.0\.0/);
    } finally {
      if (previous) process.env.TEAMAPI_API_TOKEN = previous;
    }
  });

  it("reports a missing pattern set before trying to bind anything", async () => {
    const config = await writeConfig("defaults:\n  serve:\n    port: 8080\n");
    await expect(runServeApi([], { config })).rejects.toThrow(/No patterns given/);
  });
});

describe("config errors reach every command that reads one", () => {
  it.each([
    ["gaps", async (config: string) => (await import("../commands/gaps")).runGaps([ACME_ROOT], { config })],
    ["policy", async (config: string) => (await import("../commands/policy")).runPolicy([ACME_ROOT], { config })],
    ["topology", async (config: string) => (await import("../commands/topology")).runTopology([ACME_ROOT], { config })],
    [
      "shadow-ai",
      async (config: string) =>
        (await import("../commands/shadow-ai")).runShadowAi([ACME_ROOT], { scan: ACME_ROOT, config }),
    ],
    [
      "pagerduty-drift",
      async (config: string) =>
        (await import("../commands/pagerduty-drift")).runPagerDutyDrift([ACME_ROOT], { config }),
    ],
  ])("%s exits 1 on a bad config instead of resolving anything", async (_name, run) => {
    const config = await writeConfig("gaps:\n  waviers: []\n");
    expect(await run(config)).toBe(1);
  });

  it.each([
    ["gaps", async (config: string) => (await import("../commands/gaps")).runGaps([], { config })],
    ["policy", async (config: string) => (await import("../commands/policy")).runPolicy([], { config })],
    ["topology", async (config: string) => (await import("../commands/topology")).runTopology([], { config })],
    [
      "shadow-ai",
      async (config: string) => (await import("../commands/shadow-ai")).runShadowAi([], { scan: ACME_ROOT, config }),
    ],
  ])("%s exits 1 when nothing supplies patterns", async (_name, run) => {
    const config = await writeConfig("patterns: []\n");
    expect(await run(config)).toBe(1);
    expect(stderr()).toContain("No patterns given");
  });
});

describe("defaults.pagerduty.url", () => {
  it("is optional — the client has its own default base URL", async () => {
    // Unlike Okta and Paperclip, PagerDuty's API lives at one well-known host, so a missing
    // config value is not an error here. Reaching the token check proves it got that far.
    const config = await writeConfig("defaults: {}\n");
    const previous = process.env.PAGERDUTY_TOKEN;
    delete process.env.PAGERDUTY_TOKEN;
    try {
      const { runPagerDutyDrift } = await import("../commands/pagerduty-drift");
      expect(await runPagerDutyDrift([ACME_ROOT], { config })).toBe(1);
      expect(stderr()).toMatch(/token/i);
    } finally {
      if (previous) process.env.PAGERDUTY_TOKEN = previous;
    }
  });
});
