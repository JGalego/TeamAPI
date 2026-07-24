import { getTeam, listRoles, type OrgGraph, type TeamId } from "@jgalego/teamapi-core";

export interface ChatPersonaTarget {
  teamId: TeamId;
  memberId?: string;
}

export interface ChatPersona {
  /** Display name used to label the assistant's replies, e.g. "Stream Checkout" or "Diego Alves". */
  name: string;
  systemPrompt: string;
}

/**
 * Builds a persona for `teamapi chat`: either speaking as a whole team, or as one specific member
 * on that team. The system prompt stays short and tells the model to use the available tools for
 * anything beyond its own identity — unlike the CrewAI generator's `synthesizeBackstory` (no tool
 * access, must self-contain every fact), this persona has live tool access to the whole org graph.
 */
export function buildChatPersona(graph: OrgGraph, target: ChatPersonaTarget): ChatPersona {
  const team = getTeam(graph, target.teamId);
  if (!team) throw new Error(`Unknown team id: ${target.teamId}`);

  const teamLine = `a ${team.doc.info.type} team${team.doc.info.focus ? ` focused on: ${team.doc.info.focus}.` : "."}`;
  const toolsLine =
    "Use the available tools to look up real facts about this team or any other team in the org — including cognitive load, services, interactions, and dependencies. Don't guess or make up specifics; look them up. Stay in character, but you can discuss any team in the org when asked.";

  if (!target.memberId) {
    const roleNames = listRoles(graph, target.teamId).map((r) => r.role.name);
    const systemPrompt = [
      `You are speaking on behalf of ${team.doc.info.name}, ${teamLine}`,
      roleNames.length > 0 ? `Roles on this team: ${roleNames.join(", ")}.` : undefined,
      toolsLine,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n");
    return { name: team.doc.info.name, systemPrompt };
  }

  const member = team.doc.members.find((m) => m.id === target.memberId);
  if (!member) throw new Error(`Unknown member id '${target.memberId}' on team '${target.teamId}'`);
  const roleNames = listRoles(graph, target.teamId)
    .filter((r) => member.roleIds.includes(r.role.id))
    .map((r) => r.role.name);

  const systemPrompt = [
    `You are ${member.name}${roleNames.length > 0 ? ` (${roleNames.join(", ")})` : ""} on ${team.doc.info.name}, ${teamLine}`,
    toolsLine,
  ].join("\n\n");
  return { name: member.name, systemPrompt };
}
