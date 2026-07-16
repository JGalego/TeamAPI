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

/** A role-level relationship declared via `Role.reportsToRef`/`Role.alignsWith`, resolved across
 * team documents the same way `GraphEdge` resolves team-level `$ref`s. Kept separate from
 * `GraphEdge` because it's a finer-grained (role, not team) relationship. */
export interface RoleGraphEdge {
  kind: "reports-to" | "aligns-with";
  fromTeam: TeamId;
  fromRole: string;
  toTeam: TeamId;
  toRole: string;
}

export interface OrgGraph {
  teams: Map<TeamId, ResolvedTeam>;
  edges: GraphEdge[];
  roleEdges: RoleGraphEdge[];
  unresolved: UnresolvedRef[];
  meta: { resolvedAt: string; sourceRoots: string[] };
}
