import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildCrewAiCrewConfig, buildCrewAiOrgConfig, toCrewAiCrewYaml, toCrewAiOrgYaml } from "../generators/crewai";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

describe("crewai generator — examples/acme-org", () => {
  it("builds one agent per role and one task per responsibility for a single team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const crew = buildCrewAiCrewConfig(graph, "platform-payments");

    expect(Object.keys(crew.agents).sort()).toEqual([
      "head_of_engineering",
      "ledger_engineer",
      "payments_engineer",
      "tech_lead",
    ]);
    expect(crew.tasks["tech_lead_task_1"]).toEqual({
      description: "Payments platform architecture",
      expected_output: "A short status report confirming progress on: Payments platform architecture.",
      agent: "tech_lead",
    });
  });

  it("uses a responsibility's doneWhen as expected_output when declared, instead of the generic fallback", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const crew = buildCrewAiCrewConfig(graph, "platform-payments");

    expect(crew.tasks["tech_lead_task_2"]).toEqual({
      description: "On-call escalation point",
      expected_output: "A runbook exists and the on-call rotation is staffed for the current quarter.",
      agent: "tech_lead",
    });
  });

  it("picks a hierarchical process + manager agent when a same-team role hierarchy exists", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const crew = buildCrewAiCrewConfig(graph, "platform-payments");

    expect(crew.process).toBe("hierarchical");
    expect(crew.managerAgent).toBe("head_of_engineering");
  });

  it("falls back to sequential when the only manager-like role reports cross-team (reportsToRef)", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const crew = buildCrewAiCrewConfig(graph, "stream-checkout");

    expect(crew.process).toBe("sequential");
    expect(crew.managerAgent).toBeUndefined();
  });

  it("serializes a single crew to YAML", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const crew = buildCrewAiCrewConfig(graph, "stream-checkout");
    const { agentsYaml, tasksYaml } = toCrewAiCrewYaml(crew);

    expect(agentsYaml).toMatchSnapshot();
    expect(tasksYaml).toMatchSnapshot();
  });

  it("builds a whole-org config with one crew per team and cross-team relationships", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const org = buildCrewAiOrgConfig(graph);

    expect(org.crews.map((c) => c.teamId)).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
    expect(org.relationships.some((r) => r.kind === "dependency")).toBe(true);
    expect(org.relationships.some((r) => r.kind === "platform")).toBe(true);
  });

  it("serializes the whole-org manifest to YAML", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const org = buildCrewAiOrgConfig(graph);
    const { orgYaml } = toCrewAiOrgYaml(org);

    expect(orgYaml).toMatchSnapshot();
  });
});
