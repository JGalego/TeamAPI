import type { DiagramModel } from "./diagram-model";

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\n/g, "<br/>");
}

export function toMermaid(model: DiagramModel): string {
  const lines: string[] = ["flowchart LR"];
  for (const node of model.nodes) {
    lines.push(`  ${sanitizeId(node.id)}["${escapeLabel(node.label)}"]`);
  }
  for (const edge of model.edges) {
    const arrow = edge.style === "solid" || !edge.style ? "-->" : "-.->";
    const label = edge.label ? `|${escapeLabel(edge.label)}|` : "";
    lines.push(`  ${sanitizeId(edge.from)} ${arrow}${label} ${sanitizeId(edge.to)}`);
  }
  return lines.join("\n");
}
