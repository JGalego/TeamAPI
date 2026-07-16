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
  style?: "solid" | "dashed" | "dotted";
}

/** Shared intermediate representation consumed by every diagram renderer (mermaid, dot, ...). */
export interface DiagramModel {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
