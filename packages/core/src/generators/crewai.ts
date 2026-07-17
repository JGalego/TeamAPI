import * as YAML from "js-yaml";
import { responsibilityDoneWhen, responsibilityText, type Responsibility } from "@teamapi/schema";
import type { OrgGraph, GraphEdge, TeamId } from "../model/org-graph";

export interface CrewAiAgentConfig {
  role: string;
  goal: string;
  backstory: string;
}

export interface CrewAiTaskConfig {
  description: string;
  expected_output: string;
  agent: string;
}

export type CrewAiProcess = "sequential" | "hierarchical";

export interface CrewAiCrewConfig {
  teamId: TeamId;
  name: string;
  process: CrewAiProcess;
  managerAgent?: string;
  agents: Record<string, CrewAiAgentConfig>;
  tasks: Record<string, CrewAiTaskConfig>;
}

export interface CrewAiRelationship {
  from: TeamId;
  to: TeamId;
  kind: GraphEdge["kind"];
  label: string;
}

export interface CrewAiOrgConfig {
  crews: CrewAiCrewConfig[];
  relationships: CrewAiRelationship[];
}

function slug(id: string): string {
  return id.replace(/-/g, "_");
}

function synthesizeGoal(role: { name: string; responsibilities: Responsibility[] }, teamName: string): string {
  if (role.responsibilities.length === 0) {
    return `Fulfill the duties of the ${role.name} role on the ${teamName} team.`;
  }
  return `Ensure that ${role.responsibilities.map(responsibilityText).join("; ")}.`;
}

function synthesizeExpectedOutput(responsibility: string): string {
  return `A short status report confirming progress on: ${responsibility}.`;
}

function synthesizeBackstory(
  role: { name: string; kind: string },
  team: { name: string; focus?: string },
  serviceNames: string[],
): string {
  let text = `You are the ${role.name} (${role.kind}) on ${team.name}`;
  text += team.focus ? `, which focuses on: ${team.focus}.` : ".";
  if (serviceNames.length > 0) {
    text += ` The team owns: ${serviceNames.join(", ")}.`;
  }
  return text;
}

/**
 * Builds one CrewAI crew (agents + tasks) from a single team's `roles[]`/`responsibilities[]`.
 * Every field is derived straight from real Team API data. `expected_output` uses a
 * responsibility's `doneWhen` when the author bothered to declare one; otherwise it falls back
 * to a generic status-report stand-in, since most responsibilities are plain strings with no
 * such field to draw from.
 *
 * A same-team `reportsTo` chain with exactly one un-managed top role (reported to by others, but
 * itself reporting to no one — same-team or cross-team) is treated as a CrewAI hierarchical
 * process manager; anything flatter or ambiguous falls back to `sequential`.
 */
export function buildCrewAiCrewConfig(graph: OrgGraph, teamId: TeamId): CrewAiCrewConfig {
  const team = graph.teams.get(teamId);
  if (!team) throw new Error(`Unknown team id: ${teamId}`);

  const serviceNames = team.doc.services.map((s) => s.name);
  const agents: Record<string, CrewAiAgentConfig> = {};
  const tasks: Record<string, CrewAiTaskConfig> = {};

  for (const role of team.doc.roles) {
    const key = slug(role.id);
    agents[key] = {
      role: role.name,
      goal: synthesizeGoal(role, team.doc.info.name),
      backstory: synthesizeBackstory(role, team.doc.info, serviceNames),
    };
    role.responsibilities.forEach((responsibility, i) => {
      const text = responsibilityText(responsibility);
      tasks[`${key}_task_${i + 1}`] = {
        description: text,
        expected_output: responsibilityDoneWhen(responsibility) ?? synthesizeExpectedOutput(text),
        agent: key,
      };
    });
  }

  const reportsToCounts = new Map<string, number>();
  for (const role of team.doc.roles) {
    if (role.reportsTo) {
      reportsToCounts.set(role.reportsTo, (reportsToCounts.get(role.reportsTo) ?? 0) + 1);
    }
  }
  const managerCandidates = team.doc.roles.filter(
    (role) => !role.reportsTo && !role.reportsToRef && (reportsToCounts.get(role.id) ?? 0) > 0,
  );

  const manager = managerCandidates.length === 1 ? managerCandidates[0] : undefined;
  const process: CrewAiProcess = manager ? "hierarchical" : "sequential";
  const managerAgent = manager ? slug(manager.id) : undefined;

  return { teamId, name: team.doc.info.name, process, managerAgent, agents, tasks };
}

function describeEdge(edge: GraphEdge): string {
  if (edge.kind === "interaction") return `interaction (${edge.mode})${edge.purpose ? `: ${edge.purpose}` : ""}`;
  if (edge.kind === "dependency") return `dependency (${edge.type})${edge.description ? `: ${edge.description}` : ""}`;
  return "platform";
}

/**
 * Builds a whole-org CrewAI config: one crew per team, plus the cross-team `relationships[]`
 * (interactions/dependencies/platform edges) a manager crew or Flow could use to wire crews
 * together. That wiring itself is Python glue code, out of scope for config generation — this
 * only emits the data describing which crews exist and how they relate.
 */
export function buildCrewAiOrgConfig(graph: OrgGraph): CrewAiOrgConfig {
  const crews = [...graph.teams.keys()].sort().map((teamId) => buildCrewAiCrewConfig(graph, teamId));

  const relationships: CrewAiRelationship[] = graph.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    label: describeEdge(edge),
  }));

  return { crews, relationships };
}

export interface CrewAiCrewYaml {
  agentsYaml: string;
  tasksYaml: string;
}

/** Serializes a single crew's `agents`/`tasks` to the two YAML files CrewAI's own
 * `crewai create crew` scaffold expects under `config/` (`agents.yaml`, `tasks.yaml`). */
export function toCrewAiCrewYaml(crew: CrewAiCrewConfig): CrewAiCrewYaml {
  return {
    agentsYaml: YAML.dump(crew.agents, { lineWidth: -1, noRefs: true }),
    tasksYaml: YAML.dump(crew.tasks, { lineWidth: -1, noRefs: true }),
  };
}

export interface CrewAiOrgYaml {
  orgYaml: string;
  crews: Array<{ teamId: TeamId } & CrewAiCrewYaml>;
}

/** Serializes a whole-org config to a top-level `org.yaml` manifest (crew list + process/manager
 * metadata + cross-team relationships) plus each crew's own `agents.yaml`/`tasks.yaml`. */
export function toCrewAiOrgYaml(config: CrewAiOrgConfig): CrewAiOrgYaml {
  const manifest = {
    crews: Object.fromEntries(
      config.crews.map((c) => [
        c.teamId,
        {
          name: c.name,
          config: `${c.teamId}/`,
          process: c.process,
          ...(c.managerAgent ? { managerAgent: c.managerAgent } : {}),
        },
      ]),
    ),
    relationships: config.relationships,
  };

  return {
    orgYaml: YAML.dump(manifest, { lineWidth: -1, noRefs: true }),
    crews: config.crews.map((c) => ({ teamId: c.teamId, ...toCrewAiCrewYaml(c) })),
  };
}
