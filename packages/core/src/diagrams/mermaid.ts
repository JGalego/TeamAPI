import type { DiagramModel } from "./diagram-model";

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\n/g, "<br/>");
}

function arrowFor(style: DiagramModel["edges"][number]["style"]): string {
  if (style === "plain") return "---";
  if (style === "dashed" || style === "dotted") return "-.->";
  return "-->";
}

export function toMermaid(model: DiagramModel): string {
  const lines: string[] = [`flowchart ${model.direction ?? "LR"}`];

  const groupedNodeIds = new Set<string>();
  for (const group of model.groups ?? []) {
    const groupNodes = model.nodes.filter((n) => n.groupId === group.id);
    if (groupNodes.length === 0) continue;
    lines.push(`  subgraph ${sanitizeId(group.id)}["${escapeLabel(group.label)}"]`);
    for (const node of groupNodes) {
      lines.push(`    ${sanitizeId(node.id)}["${escapeLabel(node.label)}"]`);
      groupedNodeIds.add(node.id);
    }
    lines.push("  end");
  }
  for (const node of model.nodes) {
    if (groupedNodeIds.has(node.id)) continue;
    lines.push(`  ${sanitizeId(node.id)}["${escapeLabel(node.label)}"]`);
  }
  for (const edge of model.edges) {
    const arrow = arrowFor(edge.style);
    const label = edge.label ? `|"${escapeLabel(edge.label)}"|` : "";
    lines.push(`  ${sanitizeId(edge.from)} ${arrow}${label} ${sanitizeId(edge.to)}`);
  }
  lines.push("  classDef default fill:#ede9fe,stroke:#7c3aed,stroke-width:1px,color:#1e1b4b;");
  return lines.join("\n");
}
