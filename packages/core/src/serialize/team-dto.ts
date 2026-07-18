import type { Channel, Meeting, Member, Role, Service } from "@jgalego/teamapi-schema";
import { scoreCognitiveLoad, type CognitiveLoadLabel } from "../cognitive-load/score";
import type { OrgGraph, ResolvedTeam, TeamId } from "../model/org-graph";

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
