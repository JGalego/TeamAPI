import type { DiagramModel } from "./diagram-model";

function esc(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function toDot(model: DiagramModel): string {
  const lines: string[] = [
    `digraph "${esc(model.title)}" {`,
    `  rankdir=${model.direction === "TD" ? "TB" : "LR"};`,
    `  node [style=filled, fillcolor="#ede9fe", color="#7c3aed", fontcolor="#1e1b4b"];`,
  ];
  const groupedNodeIds = new Set<string>();
  (model.groups ?? []).forEach((group, i) => {
    const groupNodes = model.nodes.filter((n) => n.groupId === group.id);
    if (groupNodes.length === 0) return;
    lines.push(`  subgraph cluster_${i} {`);
    lines.push(`    label="${esc(group.label)}";`);
    for (const node of groupNodes) {
      lines.push(`    "${esc(node.id)}" [label="${esc(node.label)}"];`);
      groupedNodeIds.add(node.id);
    }
    lines.push("  }");
  });
  for (const node of model.nodes) {
    if (groupedNodeIds.has(node.id)) continue;
    lines.push(`  "${esc(node.id)}" [label="${esc(node.label)}"];`);
  }
  for (const edge of model.edges) {
    const attrs: string[] = [];
    if (edge.label) attrs.push(`label="${esc(edge.label)}"`);
    if (edge.style === "plain") attrs.push("dir=none");
    else if (edge.style === "dashed" || edge.style === "dotted") attrs.push(`style=${edge.style}`);
    const suffix = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
    lines.push(`  "${esc(edge.from)}" -> "${esc(edge.to)}"${suffix};`);
  }
  lines.push("}");
  return lines.join("\n");
}
