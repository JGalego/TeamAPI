import { scoreCognitiveLoad } from "../cognitive-load/score";
import type { OrgGraph, TeamId } from "../model/org-graph";

/** A Port blueprint — the schema an entity is validated against. */
export interface PortBlueprint {
  identifier: string;
  title: string;
  icon: string;
  schema: {
    properties: Record<string, { type: string; title: string; format?: string; enum?: string[] }>;
    required: string[];
  };
  relations: Record<string, { title: string; target: string; required: boolean; many: boolean }>;
}

export interface PortEntity {
  identifier: string;
  title: string;
  blueprint: string;
  properties: Record<string, unknown>;
  relations: Record<string, string | string[]>;
}

export interface PortCatalog {
  blueprints: PortBlueprint[];
  entities: PortEntity[];
}

const TEAM = "teamapi_team";
const SERVICE = "teamapi_service";
const PERSON = "teamapi_person";

/**
 * The three blueprints this catalog needs.
 *
 * Roles are folded into the person entity rather than given a blueprint of their own. Port models
 * entities and relations between them; a role with nobody in it is a real thing in Team API but
 * has no natural Port shape, and inventing one would mean a blueprint that is empty for most orgs.
 */
export function portBlueprints(): PortBlueprint[] {
  return [
    {
      identifier: TEAM,
      title: "Team",
      icon: "Team",
      schema: {
        properties: {
          topology: {
            type: "string",
            title: "Topology",
            enum: ["stream-aligned", "platform", "complicated-subsystem", "enabling"],
          },
          focus: { type: "string", title: "Focus" },
          cognitiveLoad: { type: "number", title: "Cognitive load" },
          cognitiveLoadLabel: {
            type: "string",
            title: "Cognitive load label",
            enum: ["sustainable", "elevated", "overloaded"],
          },
        },
        required: ["topology"],
      },
      relations: {
        members: { title: "Members", target: PERSON, required: false, many: true },
      },
    },
    {
      identifier: SERVICE,
      title: "Service",
      icon: "Service",
      schema: {
        properties: {
          repository: { type: "string", title: "Repository", format: "url" },
          versioning: { type: "string", title: "Versioning" },
        },
        required: [],
      },
      relations: {
        owner: { title: "Owned by", target: TEAM, required: true, many: false },
      },
    },
    {
      identifier: PERSON,
      title: "Person",
      icon: "User",
      schema: {
        properties: {
          email: { type: "string", title: "Email", format: "email" },
          githubUsername: { type: "string", title: "GitHub username" },
          allocation: { type: "number", title: "Allocation (%)" },
        },
        required: [],
      },
      relations: {},
    },
  ];
}

/** Drops keys with no value, so Port isn't sent `"focus": undefined`. */
function defined(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined && v !== ""));
}

/**
 * Builds a Port catalog from the org graph: one entity per team, per person and per service.
 *
 * The interesting difference from the `backstage.ts` target is `cognitiveLoad`. Port
 * scores and colours numeric properties, so a team's self-assessed load becomes something you can
 * sort and alert on, rather than a field nobody reads. Backstage's entity model has nowhere to
 * put it.
 *
 * People are emitted once per team that lists them. A person on two teams is one entity related
 * to both, since Port entity identifiers are global.
 */
export function buildPortCatalog(graph: OrgGraph, teamId?: TeamId): PortCatalog {
  const teamIds = teamId ? [teamId] : [...graph.teams.keys()].sort();
  if (teamId && !graph.teams.has(teamId)) throw new Error(`Unknown team id: ${teamId}`);

  const people = new Map<string, PortEntity>();
  const entities: PortEntity[] = [];

  for (const id of teamIds) {
    const doc = graph.teams.get(id)!.doc;
    const load = doc.cognitiveLoad ? scoreCognitiveLoad(doc.cognitiveLoad) : undefined;

    entities.push({
      identifier: id,
      title: doc.info.name,
      blueprint: TEAM,
      properties: defined({
        topology: doc.info.type,
        focus: doc.info.focus,
        cognitiveLoad: load?.total,
        cognitiveLoadLabel: load?.label,
      }),
      relations: { members: doc.members.map((m) => m.id) },
    });

    for (const member of doc.members) {
      if (people.has(member.id)) continue;
      people.set(member.id, {
        identifier: member.id,
        title: member.name,
        blueprint: PERSON,
        properties: defined({
          email: member.contact,
          githubUsername: member.githubUsername,
          allocation: member.allocation,
        }),
        relations: {},
      });
    }

    for (const service of doc.services) {
      entities.push({
        identifier: service.name,
        title: service.name,
        blueprint: SERVICE,
        properties: defined({ repository: service.repository, versioning: service.versioning?.type }),
        relations: { owner: id },
      });
    }
  }

  return { blueprints: portBlueprints(), entities: [...people.values(), ...entities] };
}
