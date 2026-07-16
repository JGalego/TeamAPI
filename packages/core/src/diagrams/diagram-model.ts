export interface DiagramNode {
  id: string;
  label: string;
  kind?: string;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** "plain" renders a bare connector with no arrowhead — for tree/org-chart edges where the
   * top-down layout itself conveys parent → child, and an arrow or label would be noise. */
  style?: "solid" | "dashed" | "dotted" | "plain";
}

/** Shared intermediate representation consumed by every diagram renderer (mermaid, dot, ...). */
export interface DiagramModel {
  title: string;
  /** Layout direction. "TD" (top-down) suits trees like the role hierarchy; "LR" (left-right,
   * the default) suits relationship graphs like topology/context-map. */
  direction?: "LR" | "TD";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
