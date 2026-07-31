import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildTopologyDiagram } from "../diagrams/topology";
import { buildHierarchyDiagram } from "../diagrams/hierarchy";
import { buildOrgHierarchyDiagram } from "../diagrams/org-hierarchy";
import { buildContextMapDiagram } from "../diagrams/context-map";
import { deriveContextMap } from "../context-map/derive";
import { toMermaid } from "../diagrams/mermaid";
import { toDot } from "../diagrams/dot";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

describe("diagram generation — examples/acme-org", () => {
  it("renders the topology diagram as Mermaid", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildTopologyDiagram(graph);
    expect(toMermaid(model)).toMatchSnapshot();
  });

  it("renders the topology diagram as DOT", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildTopologyDiagram(graph);
    expect(toDot(model)).toMatchSnapshot();
  });

  it("renders a scoped topology diagram for a single team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildTopologyDiagram(graph, "stream-checkout");
    expect(toMermaid(model)).toMatchSnapshot();
  });

  it("renders the role hierarchy diagram for stream-checkout", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildHierarchyDiagram(graph, "stream-checkout");
    expect(toMermaid(model)).toMatchSnapshot();
  });

  it("renders the org-wide role hierarchy diagram as Mermaid, grouped into boxes per team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildOrgHierarchyDiagram(graph);
    expect(toMermaid(model)).toMatchSnapshot();
  });

  it("renders the org-wide role hierarchy diagram as DOT", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const model = buildOrgHierarchyDiagram(graph);
    expect(toDot(model)).toMatchSnapshot();
  });

  it("leaves the org hierarchy untouched unless agents are asked for", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    expect(toMermaid(buildOrgHierarchyDiagram(graph, {}))).toBe(toMermaid(buildOrgHierarchyDiagram(graph)));
    expect(toMermaid(buildOrgHierarchyDiagram(graph))).not.toContain("🤖");
  });

  it("hangs each agent off the human who owns it", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const out = toMermaid(buildOrgHierarchyDiagram(graph, { includeAgents: true }));
    expect(out).toContain('platform_payments__agent__test_generator["🤖 Test Generator (agent)"]');
    expect(out).toContain(
      'platform_payments__payments_engineer -.->|"supervises"| platform_payments__agent__test_generator',
    );
  });

  it("labels a paused agent with its status rather than hiding it", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const out = toMermaid(buildOrgHierarchyDiagram(graph, { includeAgents: true }));
    expect(out).toContain("🤖 Compliance Auditor (agent, inactive)");
  });

  it("gives an agent nobody owns no incoming edge, so it visibly floats", async () => {
    const driftwood = path.resolve(__dirname, "../../../../examples/driftwood-org/stream-insights/teamapi.yml");
    const graph = await buildOrgGraph({ seedUris: [driftwood] });
    const out = toMermaid(buildOrgHierarchyDiagram(graph, { includeAgents: true }));
    expect(out).toContain("🤖 Report Writer (agent)");
    expect(out).not.toContain("stream_insights__agent__report_writer\n");
    expect(out).not.toMatch(/-.->\|"supervises"\| stream_insights__agent__report_writer/);
    // The one with a dangling ownerId floats for the same reason: dana-whitfield is not a member.
    expect(out).not.toMatch(/-.->\|"supervises"\| platform_data__agent__pipeline_reviewer/);
  });

  it("renders the org-wide context map diagram", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const contextMap = deriveContextMap(graph);
    const model = buildContextMapDiagram(graph, contextMap);
    expect(toMermaid(model)).toMatchSnapshot();
  });
});
