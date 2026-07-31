import type { ContextMappingPattern, DependencyType, InteractionMode, TeamApiDocument } from "@jgalego/teamapi-schema";

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
  /** `reports-to` is the formal hierarchy. The rest come from `alignsWith[].kind` and describe the
   * informal network — who advises whom, who learns a practice from whom, which community of
   * practice a role belongs to — which the reporting lines never explain. */
  kind: "reports-to" | "aligns-with" | "advises" | "learns-from" | "community-of-practice";
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
