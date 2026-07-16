import type { ContextMappingPattern, DependencyType, InteractionMode, TeamApiDocument } from "@teamapi/schema";

export type TeamId = string;

export interface ResolvedTeam {
  id: TeamId;
  sourceUri: string;
  doc: TeamApiDocument;
}

export interface UnresolvedRef {
  fromUri: string;
  ref: string;
  reason: string;
}

export type GraphEdge =
  | {
      kind: "interaction";
      from: TeamId;
      to: TeamId;
      mode: InteractionMode;
      contextMappingPattern?: ContextMappingPattern;
      purpose?: string;
      startDate?: string;
    }
  | { kind: "dependency"; from: TeamId; to: TeamId; type: DependencyType; description?: string }
  | { kind: "platform"; from: TeamId; to: TeamId };

export interface OrgGraph {
  teams: Map<TeamId, ResolvedTeam>;
  edges: GraphEdge[];
  unresolved: UnresolvedRef[];
  meta: { resolvedAt: string; sourceRoots: string[] };
}
