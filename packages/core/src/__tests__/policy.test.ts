import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { BUILTIN_POLICY_RULE_KEYS, checkPolicies, formatPolicyReport, type PolicyFinding } from "../policy/check";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-policy-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Builds a one-team graph carrying a single policy, so each rule can be exercised in isolation. */
async function graphWithPolicy(
  rules: { key: string; value?: unknown }[],
  options: {
    severity?: string;
    enforcedBy?: string[];
    team?: Record<string, unknown>;
  } = {},
) {
  const file = path.join(tmpDir, "team.yml");
  const doc = {
    teamApiVersion: "1.0.0",
    id: "team-a",
    info: { name: "Team A", type: "stream-aligned" },
    policies: [
      {
        id: "the-policy",
        name: "The Policy",
        category: "custom",
        severity: options.severity ?? "blocking",
        rules,
        ...(options.enforcedBy ? { enforcedBy: options.enforcedBy } : {}),
      },
    ],
    ...options.team,
  };
  await fs.writeFile(file, JSON.stringify(doc), "utf-8");
  return buildOrgGraph({ seedUris: [file] });
}

const only = (findings: PolicyFinding[]) => {
  expect(findings).toHaveLength(1);
  return findings[0]!;
};

describe("checkPolicies — rules nothing can check here", () => {
  it("reports a rule with no evaluator as delegated when enforcedBy names an enforcer", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "min_approvals", value: 2 }], { enforcedBy: ["ci"] }));
    const finding = only(report.findings);
    expect(finding.outcome).toBe("delegated");
    expect(finding.detail).toContain("enforced by ci");
  });

  it("never counts a delegated rule as evaluated, so the pass ratio stays honest", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "min_approvals", value: 2 }], { enforcedBy: ["ci"] }));
    expect(report).toMatchObject({ satisfied: 0, evaluated: 0, total: 1 });
  });

  it("downgrades a delegated finding to info, whatever the policy claims for itself", async () => {
    // Naming an external enforcer is the correct thing to do. It must never fail a build.
    const report = checkPolicies(await graphWithPolicy([{ key: "min_approvals", value: 2 }], { enforcedBy: ["ci"] }));
    expect(only(report.findings).severity).toBe("info");
  });

  /** The finding this module exists for: governance that reads as enforced and is checked by
   * nobody, here or anywhere else. */
  it("reports a rule with no evaluator and no enforcedBy as unenforced, at the policy's own severity", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "min_approvals", value: 2 }]));
    expect(only(report.findings)).toMatchObject({ outcome: "unenforced", severity: "blocking" });
  });

  it("keeps an unenforced warning-severity policy a warning", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "whatever" }], { severity: "warning" }));
    expect(only(report.findings).severity).toBe("warning");
  });
});

describe("checkPolicies — agents_allowed", () => {
  it("passes a team that declares no agents", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "agents_allowed", value: false }]));
    expect(report.findings).toEqual([]);
    expect(report).toMatchObject({ satisfied: 1, evaluated: 1 });
  });

  it("violates when the team runs an active agent", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "agents_allowed", value: false }], {
        team: { agents: [{ id: "helper", name: "Helper", provider: "anthropic", role: "reviewer" }] },
      }),
    );
    expect(only(report.findings)).toMatchObject({
      outcome: "violated",
      severity: "blocking",
      ruleKey: "agents_allowed",
    });
    expect(only(report.findings).detail).toContain("helper");
  });

  it("ignores agents that are not active, since a deprecated agent runs nothing", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "agents_allowed", value: false }], {
        team: {
          agents: [{ id: "old", name: "Old", provider: "anthropic", role: "reviewer", status: "deprecated" }],
        },
      }),
    );
    expect(report.findings).toEqual([]);
  });

  it("passes trivially when agents are allowed", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "agents_allowed", value: true }], {
        team: { agents: [{ id: "helper", name: "Helper", provider: "anthropic", role: "reviewer" }] },
      }),
    );
    expect(report.findings).toEqual([]);
  });
});

describe("checkPolicies — the other built-in evaluators", () => {
  it("counts active agents against max_agents", async () => {
    const agents = ["a", "b", "c"].map((id) => ({ id, name: id, provider: "anthropic", role: "reviewer" }));
    const report = checkPolicies(await graphWithPolicy([{ key: "max_agents", value: 2 }], { team: { agents } }));
    expect(only(report.findings).detail).toContain("3 active agents, above the limit of 2");
  });

  it("requires every agent to name an owner who is on the team", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "agents_require_owner", value: true }], {
        team: {
          members: [{ id: "real-person", name: "Real Person" }],
          agents: [
            { id: "owned", name: "Owned", provider: "anthropic", role: "r", ownerId: "real-person" },
            { id: "ghost", name: "Ghost", provider: "anthropic", role: "r", ownerId: "departed" },
            { id: "nobody", name: "Nobody", provider: "anthropic", role: "r" },
          ],
        },
      }),
    );
    const detail = only(report.findings).detail;
    expect(detail).toContain("ghost");
    expect(detail).toContain("nobody");
    expect(detail).not.toContain("owned");
  });

  it("checks agent providers against an allow-list, case-insensitively", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "allowed_agent_providers", value: ["Anthropic"] }], {
        team: {
          agents: [
            { id: "fine", name: "Fine", provider: "anthropic", role: "r" },
            { id: "rogue", name: "Rogue", provider: "some-startup", role: "r" },
          ],
        },
      }),
    );
    const detail = only(report.findings).detail;
    expect(detail).toContain("'rogue' uses provider 'some-startup'");
    expect(detail).not.toContain("'fine'");
  });

  it("bounds the cognitive-load total, and treats an unassessed team as not over the limit", async () => {
    const over = checkPolicies(
      await graphWithPolicy([{ key: "max_cognitive_load", value: 15 }], {
        team: { cognitiveLoad: { intrinsic: 8, extraneous: 6, germane: 7 } },
      }),
    );
    expect(only(over.findings).detail).toContain("cognitive load total is 21");

    const unassessed = checkPolicies(await graphWithPolicy([{ key: "max_cognitive_load", value: 15 }]));
    expect(unassessed.findings).toEqual([]);
  });

  it("bounds supervision load separately from the total", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "max_supervision_load", value: 5 }], {
        team: { cognitiveLoad: { intrinsic: 1, extraneous: 1, germane: 1, supervision: 9 } },
      }),
    );
    expect(only(report.findings).detail).toContain("supervision load is 9");
  });

  it("requires steering documents by category", async () => {
    const missing = checkPolicies(
      await graphWithPolicy([{ key: "required_steering_categories", value: ["security-guidelines"] }]),
    );
    expect(only(missing.findings).detail).toContain("no steering document for security-guidelines");

    const present = checkPolicies(
      await graphWithPolicy([{ key: "required_steering_categories", value: ["security-guidelines"] }], {
        team: {
          steeringDocuments: [
            { id: "sec", title: "Security", category: "security-guidelines", body: "Do the secure thing." },
          ],
        },
      }),
    );
    expect(present.findings).toEqual([]);
  });

  it("requires playbooks by category", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "required_playbook_categories", value: ["incident-response"] }]),
    );
    expect(only(report.findings).detail).toContain("no playbook for incident-response");
  });

  it("requires services to name a repository", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "services_require_repository", value: true }], {
        team: { services: [{ name: "with-repo", repository: "https://example.test/r" }, { name: "without-repo" }] },
      }),
    );
    expect(only(report.findings).detail).toContain("without-repo");
  });

  it("requires services to declare a bounded context", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "services_require_bounded_context", value: true }], {
        team: { services: [{ name: "opaque" }] },
      }),
    );
    expect(only(report.findings).detail).toContain("opaque");
  });

  it("bounds a team's outgoing dependencies", async () => {
    const platform = path.join(tmpDir, "platform.yml");
    await fs.writeFile(
      platform,
      JSON.stringify({
        teamApiVersion: "1.0.0",
        id: "platform-b",
        info: { name: "Platform B", type: "platform" },
      }),
      "utf-8",
    );
    const report = checkPolicies(
      await graphWithPolicy([{ key: "max_dependencies", value: 0 }], {
        team: { dependencies: [{ teamName: "Platform B", type: "OK", $ref: "./platform.yml" }] },
      }),
    );
    expect(only(report.findings).detail).toContain("1 dependency, above the limit of 0");
  });
});

describe("checkPolicies — misconfigured rules", () => {
  it("reports a value of the wrong type as misconfigured, not as a violation", async () => {
    const report = checkPolicies(await graphWithPolicy([{ key: "max_agents", value: "two" }]));
    expect(only(report.findings)).toMatchObject({ outcome: "misconfigured", ruleKey: "max_agents" });
  });

  it("keeps a misconfigured rule at warning even on a blocking policy", async () => {
    // A typo in the document is not evidence the team is out of compliance, and must not fail a
    // build as though it were.
    const report = checkPolicies(
      await graphWithPolicy([{ key: "max_agents", value: "two" }], { severity: "blocking" }),
    );
    expect(only(report.findings).severity).toBe("warning");
  });
});

describe("checkPolicies — the bundled example org", () => {
  const acme = () => buildOrgGraph({ seedUris: [path.join(ACME_ROOT, "stream-checkout/teamapi.yml")] });

  it("delegates payments' min_approvals and satisfies onboarding's agent ban", async () => {
    const report = checkPolicies(await acme());

    const delegated = report.findings.filter((f) => f.outcome === "delegated");
    expect(delegated).toHaveLength(1);
    expect(delegated[0]).toMatchObject({ teamId: "platform-payments", ruleKey: "min_approvals" });

    // Stream Onboarding declares `agents_allowed: false` and runs no agents — a real policy,
    // really checked, really passing.
    expect(report.satisfied).toBe(1);
    expect(report.findings.filter((f) => f.outcome === "violated")).toEqual([]);
  });
});

describe("formatPolicyReport", () => {
  it("says so plainly when no policies are declared", async () => {
    const empty = await buildOrgGraph({
      seedUris: [
        await (async () => {
          const file = path.join(tmpDir, "bare.yml");
          await fs.writeFile(
            file,
            JSON.stringify({ teamApiVersion: "1.0.0", id: "bare", info: { name: "Bare", type: "platform" } }),
            "utf-8",
          );
          return file;
        })(),
      ],
    });
    expect(formatPolicyReport(checkPolicies(empty))).toBe("No policies declared.");
  });

  it("counts blocking findings but never counts delegated ones as blocking", async () => {
    const report = checkPolicies(
      await graphWithPolicy([{ key: "min_approvals", value: 2 }], { enforcedBy: ["ci"], severity: "blocking" }),
    );
    expect(formatPolicyReport(report)).toContain("1 finding(s), 0 blocking.");
  });

  it("reports the checked-here ratio alongside the declared total", async () => {
    const report = checkPolicies(
      await graphWithPolicy([
        { key: "agents_allowed", value: false },
        { key: "min_approvals", value: 2 },
      ]),
    );
    expect(formatPolicyReport(report)).toContain("1/1 rule(s) checked here pass; 2 rule(s) declared in total.");
  });
});

describe("BUILTIN_POLICY_RULE_KEYS", () => {
  it("lists every key the engine can decide, sorted", async () => {
    expect(BUILTIN_POLICY_RULE_KEYS).toContain("agents_allowed");
    expect(BUILTIN_POLICY_RULE_KEYS).toEqual([...BUILTIN_POLICY_RULE_KEYS].sort());
  });

  it("has an evaluator for every key it advertises", async () => {
    // Guards the docs/`--help` list against drifting from the actual evaluator table.
    for (const key of BUILTIN_POLICY_RULE_KEYS) {
      const report = checkPolicies(await graphWithPolicy([{ key, value: Symbol.iterator.toString() }]));
      // A key with an evaluator reports `misconfigured` for a nonsense value; one without an
      // evaluator would report `unenforced` instead.
      expect(only(report.findings).outcome, key).toBe("misconfigured");
    }
  });
});
