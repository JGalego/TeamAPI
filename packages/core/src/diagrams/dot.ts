import type { DiagramModel } from "./diagram-model";

function esc(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function toDot(model: DiagramModel): string {
  const lines: string[] = [`digraph "${esc(model.title)}" {`, "  rankdir=LR;"];
  for (const node of model.nodes) {
    lines.push(`  "${esc(node.id)}" [label="${esc(node.label)}"];`);
  }
  for (const edge of model.edges) {
    const attrs: string[] = [];
    if (edge.label) attrs.push(`label="${esc(edge.label)}"`);
    if (edge.style && edge.style !== "solid") attrs.push(`style=${edge.style}`);
    const suffix = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
    lines.push(`  "${esc(edge.from)}" -> "${esc(edge.to)}"${suffix};`);
  }
  lines.push("}");
  return lines.join("\n");
}
