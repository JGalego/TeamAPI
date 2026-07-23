import * as YAML from "js-yaml";
import type { OrgGraph, TeamId } from "../model/org-graph";

const API_VERSION = "backstage.io/v1alpha1";

export interface BackstageEntityMeta {
  name: string;
  description?: string;
  title?: string;
  links?: Array<{ url: string; title?: string }>;
}

export interface BackstageGroupEntity {
  apiVersion: typeof API_VERSION;
  kind: "Group";
  metadata: BackstageEntityMeta;
  spec: { type: "team"; children: string[]; members: string[] };
}

export interface BackstageUserEntity {
  apiVersion: typeof API_VERSION;
  kind: "User";
  metadata: BackstageEntityMeta;
  spec: { memberOf: string[] };
}

export interface BackstageSystemEntity {
  apiVersion: typeof API_VERSION;
  kind: "System";
  metadata: BackstageEntityMeta;
  spec: { owner: string };
}

export interface BackstageComponentEntity {
  apiVersion: typeof API_VERSION;
  kind: "Component";
  metadata: BackstageEntityMeta;
  spec: { type: "service"; lifecycle: "production"; owner: string; system: string };
}

export type BackstageEntity = BackstageGroupEntity | BackstageUserEntity | BackstageSystemEntity | BackstageComponentEntity;

export interface BackstageCatalog {
  teamId: TeamId;
  entities: BackstageEntity[];
}

function ownerRef(teamId: TeamId): string {
  return `group:${teamId}`;
}

function meta(name: string, extra: Partial<Omit<BackstageEntityMeta, "name">> = {}): BackstageEntityMeta {
  const description = extra.description?.trim();
  const links = extra.links?.length ? extra.links : undefined;
  return {
    name,
    ...(description ? { description } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(links ? { links } : {}),
  };
}

/**
 * Builds one team's Backstage catalog entities from Team API data: a `Group` (the team, with its
 * `members[].id`), one `User` per member, and — when the team owns any `services[]` — a `System`
 * grouping them plus one `Component` per service.
 *
 * This only covers the well-defined, always-valid subset of Backstage's entity model (ownership
 * and grouping): cross-team `dependsOn` relations between `Component`s aren't attempted, since
 * Team API only models team-level `interactions[]`/`dependencies[]`, not service-level ones, and
 * guessing at a service-to-service mapping would produce misleading (if syntactically valid)
 * catalog data. `roles[]` aren't represented either — Backstage's `Group`/`User` model has no
 * concept of a role independent of the person filling it, unlike Team API's roles/members split.
 */
export function buildBackstageCatalog(graph: OrgGraph, teamId: TeamId): BackstageCatalog {
  const team = graph.teams.get(teamId);
  if (!team) throw new Error(`Unknown team id: ${teamId}`);

  const entities: BackstageEntity[] = [];

  entities.push({
    apiVersion: API_VERSION,
    kind: "Group",
    metadata: meta(teamId, { description: team.doc.info.focus, title: team.doc.info.name }),
    spec: { type: "team", children: [], members: team.doc.members.map((m) => m.id) },
  });

  for (const member of team.doc.members) {
    entities.push({
      apiVersion: API_VERSION,
      kind: "User",
      metadata: meta(member.id, { title: member.name }),
      spec: { memberOf: [teamId] },
    });
  }

  if (team.doc.services.length > 0) {
    entities.push({
      apiVersion: API_VERSION,
      kind: "System",
      metadata: meta(teamId, { description: team.doc.info.focus, title: team.doc.info.name }),
      spec: { owner: ownerRef(teamId) },
    });

    for (const service of team.doc.services) {
      entities.push({
        apiVersion: API_VERSION,
        kind: "Component",
        metadata: meta(service.name, {
          links: service.repository ? [{ url: service.repository, title: "Repository" }] : undefined,
        }),
        spec: { type: "service", lifecycle: "production", owner: ownerRef(teamId), system: teamId },
      });
    }
  }

  return { teamId, entities };
}

/** Builds every team's catalog entities, in one flat list — the shape a single combined
 * `catalog-info.yaml` at the org root needs. */
export function buildBackstageOrgCatalog(graph: OrgGraph): BackstageEntity[] {
  return [...graph.teams.keys()].sort().flatMap((teamId) => buildBackstageCatalog(graph, teamId).entities);
}

/** Serializes entities as a single multi-document YAML file — the conventional
 * `catalog-info.yaml` shape, `---`-separated documents, that Backstage's catalog processor
 * expects when multiple entities live in one file. */
export function toBackstageYaml(entities: BackstageEntity[]): string {
  return entities.map((entity) => YAML.dump(entity, { lineWidth: -1, noRefs: true })).join("---\n");
}
