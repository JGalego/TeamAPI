export interface DiagramNode {
  id: string;
  label: string;
  kind?: string;
  /** Groups this node into a rendered box (Mermaid subgraph / DOT cluster) with other nodes
   * sharing the same `groupId`. Undefined means the node isn't boxed. */
  groupId?: string;
}

/** A rendered grouping box (Mermaid subgraph / DOT cluster) — e.g. one per team, so roles from
 * different teams are visually distinguishable even when cross-team edges connect them. */
export interface DiagramGroup {
  id: string;
  label: string;
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
  groups?: DiagramGroup[];
}
