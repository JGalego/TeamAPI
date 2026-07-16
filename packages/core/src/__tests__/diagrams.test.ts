import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildTopologyDiagram } from "../diagrams/topology";
import { buildHierarchyDiagram } from "../diagrams/hierarchy";
import { buildContextMapDiagram } from "../diagrams/context-map";
import { deriveContextMap } from "../context-map/derive";
import { toMermaid } from "../diagrams/mermaid";
import { toDot } from "../diagrams/dot";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

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

  it("renders the org-wide context map diagram", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const contextMap = deriveContextMap(graph);
    const model = buildContextMapDiagram(graph, contextMap);
    expect(toMermaid(model)).toMatchSnapshot();
  });
});
