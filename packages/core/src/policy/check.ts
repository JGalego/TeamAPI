import type { Policy, PolicyRule, PolicySeverity } from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "../model/org-graph";
import { resolveEffectiveSteering } from "../model/knowledge-resources";
import { scoreCognitiveLoad } from "../cognitive-load/score";

/**
 * Evaluates the `policies[]` teams declare against the org graph they were declared on.
 *
 * `policies[]` has always been documented as governance for *external* automation to enforce, and
 * that stays true for the rules that genuinely need an outside system — `min_approvals` is a fact
 * about a branch protection rule, not about this graph, and nothing here can honestly decide it.
 * But a good number of declared policies are statements about the org's own shape ("no agents on
 * this team", "every service names a repository"), and those the graph can answer completely, for
 * free, with no credentials.
 *
 * So this splits every rule three ways rather than pretending it's one problem:
 *
 * - **checkable here** — a built-in evaluator decides it against the graph: `satisfied` or
 *   `violated`.
 * - **checkable elsewhere** — no evaluator, but `enforcedBy` names the automation that does it.
 *   Reported as `delegated`, never as a pass: this tool has not verified anything.
 * - **checked nowhere** — no evaluator and no `enforcedBy`. This is the finding that matters
 *   most, and the reason this module exists. A policy nobody enforces is indistinguishable, in
 *   the document, from one that is enforced: same `severity: blocking`, same confident prose. It
 *   reads as governance and behaves as a comment.
 *
 * That last case is the same argument `planGaps` makes about an agent whose `ownerId` names
 * nobody — the missing enforcement is not the problem, the declaration that implies it exists is.
 *
 * Pure: no I/O, no network. It only reads the graph it is handed.
 */

export type PolicyOutcome =
  /** A built-in evaluator ran and the team complies. */
  | "satisfied"
  /** A built-in evaluator ran and the team does not comply. */
  | "violated"
  /** No built-in evaluator, but `enforcedBy` names who does enforce it. Unverified here. */
  | "delegated"
  /** No built-in evaluator and no `enforcedBy`: nothing, anywhere, checks this rule. */
  | "unenforced"
  /** A built-in evaluator exists, but the rule's `value` is the wrong shape for it. */
  | "misconfigured";

export interface PolicyFinding {
  outcome: Exclude<PolicyOutcome, "satisfied">;
  /** Findings inherit the policy's own `severity`, except where noted on `checkPolicies`. */
  severity: PolicySeverity;
  teamId: TeamId;
  policyId: string;
  policyName: string;
  ruleKey: string;
  detail: string;
}

export interface PolicyReport {
  findings: PolicyFinding[];
  /** Rules a built-in evaluator checked and passed. */
  satisfied: number;
  /** Rules checked here at all, pass or fail — the denominator that says how much of the declared
   * governance this tool can actually speak to. */
  evaluated: number;
  /** Every rule on every policy across the graph. */
  total: number;
}

/** What an evaluator gets: the team's own document plus the graph it sits in. */
interface RuleContext {
  graph: OrgGraph;
  teamId: TeamId;
}

/** `ok` passes; a string is the violation message. `undefined` means the rule's value was the
 * wrong shape, which is a misconfigured policy rather than a violated one. */
type RuleVerdict = { ok: true } | { ok: false; detail: string } | undefined;

type RuleEvaluator = (value: unknown, ctx: RuleContext) => RuleVerdict;

const ok: RuleVerdict = { ok: true };
const fail = (detail: string): RuleVerdict => ({ ok: false, detail });

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return undefined;
  return value as string[];
}

function teamDoc(ctx: RuleContext) {
  return ctx.graph.teams.get(ctx.teamId)!.doc;
}

function activeAgents(ctx: RuleContext) {
  return teamDoc(ctx).agents.filter((agent) => agent.status === "active");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The built-in evaluators, keyed by the `rules[].key` they decide.
 *
 * Deliberately a small set of rules that are *fully* decidable from the graph. A rule that can
 * only be half-checked here is worse than one that is honestly delegated: a partial check that
 * reports "satisfied" is how a policy stops being read.
 */
const EVALUATORS: Record<string, RuleEvaluator> = {
  /** `false` forbids this team from running AI agents at all. */
  agents_allowed: (value, ctx) => {
    const allowed = asBoolean(value);
    if (allowed === undefined) return undefined;
    if (allowed) return ok;
    const agents = activeAgents(ctx);
    return agents.length === 0
      ? ok
      : fail(`declares ${plural(agents.length, "active agent")} (${agents.map((a) => a.id).join(", ")})`);
  },

  max_agents: (value, ctx) => {
    const max = asNumber(value);
    if (max === undefined) return undefined;
    const count = activeAgents(ctx).length;
    return count <= max ? ok : fail(`declares ${plural(count, "active agent")}, above the limit of ${max}`);
  },

  /** Every agent must name a human owner who is actually on the team. */
  agents_require_owner: (value, ctx) => {
    const required = asBoolean(value);
    if (required === undefined) return undefined;
    if (!required) return ok;
    const doc = teamDoc(ctx);
    const memberIds = new Set(doc.members.map((member) => member.id));
    const unowned = doc.agents.filter((agent) => !agent.ownerId || !memberIds.has(agent.ownerId));
    return unowned.length === 0
      ? ok
      : fail(`${plural(unowned.length, "agent")} without a resolvable owner (${unowned.map((a) => a.id).join(", ")})`);
  },

  allowed_agent_providers: (value, ctx) => {
    const allowed = asStringArray(value);
    if (allowed === undefined) return undefined;
    const permitted = new Set(allowed.map((entry) => entry.toLowerCase()));
    const offenders = activeAgents(ctx).filter((agent) => !permitted.has(agent.provider.toLowerCase()));
    return offenders.length === 0
      ? ok
      : fail(
          `${offenders.map((a) => `'${a.id}' uses provider '${a.provider}'`).join(", ")}; allowed: ${allowed.join(", ")}`,
        );
  },

  /** Ceiling on the Team Topologies three-type total. A team with no assessment cannot be over
   * it — the absence is `planGaps`'s business, not this rule's. */
  max_cognitive_load: (value, ctx) => {
    const max = asNumber(value);
    if (max === undefined) return undefined;
    const assessment = teamDoc(ctx).cognitiveLoad;
    if (!assessment) return ok;
    const { total } = scoreCognitiveLoad(assessment);
    return total <= max ? ok : fail(`cognitive load total is ${total}, above the limit of ${max}`);
  },

  max_supervision_load: (value, ctx) => {
    const max = asNumber(value);
    if (max === undefined) return undefined;
    const supervision = teamDoc(ctx).cognitiveLoad?.supervision;
    if (supervision === undefined) return ok;
    return supervision <= max ? ok : fail(`supervision load is ${supervision}, above the limit of ${max}`);
  },

  /** Checked against *effective* steering — a document inherited from the org root satisfies this
   * exactly as well as one the team wrote itself, which is the whole point of the inheritance. */
  required_steering_categories: (value, ctx) => {
    const required = asStringArray(value);
    if (required === undefined) return undefined;
    const present = new Set(resolveEffectiveSteering(ctx.graph, ctx.teamId).map((doc) => doc.category));
    const missing = required.filter((category) => !present.has(category as never));
    return missing.length === 0 ? ok : fail(`no steering document for ${missing.join(", ")}`);
  },

  required_playbook_categories: (value, ctx) => {
    const required = asStringArray(value);
    if (required === undefined) return undefined;
    const present = new Set(teamDoc(ctx).playbooks.map((playbook) => playbook.category));
    const missing = required.filter((category) => !present.has(category as never));
    return missing.length === 0 ? ok : fail(`no playbook for ${missing.join(", ")}`);
  },

  services_require_repository: (value, ctx) => {
    const required = asBoolean(value);
    if (required === undefined) return undefined;
    if (!required) return ok;
    const missing = teamDoc(ctx).services.filter((service) => !service.repository);
    return missing.length === 0
      ? ok
      : fail(`${plural(missing.length, "service")} without a repository (${missing.map((s) => s.name).join(", ")})`);
  },

  services_require_bounded_context: (value, ctx) => {
    const required = asBoolean(value);
    if (required === undefined) return undefined;
    if (!required) return ok;
    const missing = teamDoc(ctx).services.filter((service) => !service.boundedContext);
    return missing.length === 0
      ? ok
      : fail(
          `${plural(missing.length, "service")} without a boundedContext (${missing.map((s) => s.name).join(", ")})`,
        );
  },

  max_dependencies: (value, ctx) => {
    const max = asNumber(value);
    if (max === undefined) return undefined;
    const count = ctx.graph.edges.filter((edge) => edge.kind === "dependency" && edge.from === ctx.teamId).length;
    return count <= max ? ok : fail(`declares ${plural(count, "dependency")}, above the limit of ${max}`);
  },
};

/** The rule keys this tool can decide on its own, for docs and for the `--help` text. */
export const BUILTIN_POLICY_RULE_KEYS: readonly string[] = Object.keys(EVALUATORS).sort();

function evaluateRule(policy: Policy, rule: PolicyRule, ctx: RuleContext): PolicyFinding | "satisfied" | undefined {
  const base = {
    teamId: ctx.teamId,
    policyId: policy.id,
    policyName: policy.name,
    ruleKey: rule.key,
  };

  const evaluator = EVALUATORS[rule.key];
  if (!evaluator) {
    if (policy.enforcedBy.length > 0) {
      return {
        ...base,
        outcome: "delegated",
        severity: "info",
        detail: `not checkable from the org graph; enforced by ${policy.enforcedBy.join(", ")}`,
      };
    }
    return {
      ...base,
      outcome: "unenforced",
      // An unenforced policy is reported at the severity it claims for itself: a `blocking`
      // policy that nothing enforces is exactly as serious as it says it is, and that is the
      // finding worth failing a build over.
      severity: policy.severity,
      detail: `not checkable from the org graph and no enforcedBy names anything that checks it`,
    };
  }

  const verdict = evaluator(rule.value, ctx);
  if (verdict === undefined) {
    return {
      ...base,
      outcome: "misconfigured",
      // Not the policy's severity: a rule this tool cannot parse is a defect in the document,
      // not evidence the team is out of compliance. Reporting it as `blocking` would fail builds
      // over a typo while saying nothing true about the team.
      severity: "warning",
      detail: `value ${JSON.stringify(rule.value)} is not valid for '${rule.key}'`,
    };
  }
  if (verdict.ok) return "satisfied";
  return { ...base, outcome: "violated", severity: policy.severity, detail: verdict.detail };
}

export function checkPolicies(graph: OrgGraph): PolicyReport {
  const findings: PolicyFinding[] = [];
  let satisfied = 0;
  let evaluated = 0;
  let total = 0;

  for (const teamId of [...graph.teams.keys()].sort()) {
    const doc = graph.teams.get(teamId)!.doc;
    for (const policy of doc.policies) {
      for (const rule of policy.rules) {
        total++;
        const result = evaluateRule(policy, rule, { graph, teamId });
        if (result === "satisfied") {
          satisfied++;
          evaluated++;
          continue;
        }
        if (result === undefined) continue;
        if (result.outcome === "violated" || result.outcome === "misconfigured") evaluated++;
        findings.push(result);
      }
    }
  }

  return { findings, satisfied, evaluated, total };
}

const MARK: Record<PolicyFinding["outcome"], string> = {
  violated: "!",
  unenforced: "?",
  misconfigured: "-",
  delegated: "~",
};

export function formatPolicyReport(report: PolicyReport): string {
  if (report.total === 0) return "No policies declared.";

  const lines = report.findings.map(
    (finding) =>
      `${MARK[finding.outcome]} ${finding.outcome} [${finding.severity}] ${finding.teamId} / ${finding.policyId} / ${finding.ruleKey}: ${finding.detail}`,
  );

  const blocking = report.findings.filter(
    (finding) => finding.severity === "blocking" && finding.outcome !== "delegated",
  ).length;

  if (lines.length > 0) lines.push("");
  lines.push(
    `${report.satisfied}/${report.evaluated} rule(s) checked here pass; ${report.total} rule(s) declared in total.`,
  );
  if (report.findings.length > 0) {
    lines.push(`${report.findings.length} finding(s), ${blocking} blocking.`);
  }
  return lines.join("\n");
}
