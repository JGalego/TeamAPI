import type { Channel, Meeting, Member, Role, Service } from "@jgalego/teamapi-schema";
import { scoreCognitiveLoad, type CognitiveLoadLabel } from "../cognitive-load/score";
import type { GraphEdge, OrgGraph, ResolvedTeam, RoleGraphEdge, TeamId, UnresolvedRef } from "../model/org-graph";

export interface TeamSummaryDto {
  id: TeamId;
  name: string;
  type: string;
  focus?: string;
}

export interface CognitiveLoadDto {
  intrinsic: number;
  extraneous: number;
  germane: number;
  total: number;
  label: CognitiveLoadLabel;
  notes?: string;
}

export interface TeamDetailDto extends TeamSummaryDto {
  channels: Channel[];
  searchTerms: string[];
  services: Service[];
  roles: Role[];
  members: Member[];
  cognitiveLoad?: CognitiveLoadDto;
  meetings: Meeting[];
  platformRef?: string;
}

/**
 * Single source of truth for how a `ResolvedTeam` becomes a wire-format object. Both the REST
 * API and the MCP server call these functions so their responses are identical by construction.
 */
export function toTeamSummaryDto(team: ResolvedTeam): TeamSummaryDto {
  return {
    id: team.id,
    name: team.doc.info.name,
    type: team.doc.info.type,
    focus: team.doc.info.focus,
  };
}

export function toTeamDetailDto(team: ResolvedTeam): TeamDetailDto {
  const cognitiveLoad = team.doc.cognitiveLoad ? scoreCognitiveLoad(team.doc.cognitiveLoad) : undefined;
  return {
    ...toTeamSummaryDto(team),
    channels: team.doc.channels,
    searchTerms: team.doc.searchTerms.map((s) => s.term),
    services: team.doc.services,
    roles: team.doc.roles,
    members: team.doc.members,
    cognitiveLoad: cognitiveLoad
      ? {
          intrinsic: cognitiveLoad.assessment.intrinsic,
          extraneous: cognitiveLoad.assessment.extraneous,
          germane: cognitiveLoad.assessment.germane,
          total: cognitiveLoad.total,
          label: cognitiveLoad.label,
          notes: cognitiveLoad.assessment.notes,
        }
      : undefined,
    meetings: team.doc.meetings,
    platformRef: team.doc.platform?.$ref,
  };
}

export function listTeamSummaries(graph: OrgGraph): TeamSummaryDto[] {
  return [...graph.teams.values()].sort((a, b) => a.id.localeCompare(b.id)).map(toTeamSummaryDto);
}

export interface OrgGraphDto {
  teams: TeamDetailDto[];
  /** Team-level edges: interaction/dependency/platform `$ref`s. */
  edges: GraphEdge[];
  /** Role-level edges: cross-team `reportsTo`/`alignsWith` relationships resolved from
   * `roles[].reportsToRef`/`roles[].alignsWith[]`. Included here (not just in rendered
   * diagrams) so a JSON consumer of the full graph can answer "who reports cross-team?" without
   * parsing Mermaid/DOT output. */
  roleEdges: RoleGraphEdge[];
  unresolved: UnresolvedRef[];
  meta: OrgGraph["meta"];
}

/**
 * Single source of truth for "the full resolved org graph" as a wire-format object — used by
 * both the REST API's `GET /graph` and the MCP server's `get_org_graph` tool, so both surfaces
 * expose the identical shape (including `roleEdges`, easy to omit by hand).
 */
export function toOrgGraphDto(graph: OrgGraph): OrgGraphDto {
  return {
    teams: [...graph.teams.values()].map(toTeamDetailDto),
    edges: graph.edges,
    roleEdges: graph.roleEdges,
    unresolved: graph.unresolved,
    meta: graph.meta,
  };
}
