import type { ImportedTeam } from "./github-org";

/**
 * The slice of a Backstage entity this *reads*.
 *
 * Named apart from the generator's `BackstageEntity`, which is what this toolchain *writes*, and
 * they are genuinely different shapes: the generator emits a small, exact entity, while a catalog
 * in the wild is full of organization-specific annotations and custom kinds. Deliberately loose
 * for the same reason — a strict shape would reject a real catalog for carrying fields it is
 * entitled to carry.
 */
export interface BackstageCatalogEntity {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    title?: string;
    description?: string;
    annotations?: Record<string, string>;
    links?: Array<{ url?: string; title?: string }>;
  };
  spec?: {
    type?: string;
    owner?: string;
    profile?: { displayName?: string; email?: string };
    memberOf?: string[];
    children?: string[];
  };
  relations?: Array<{ type?: string; targetRef?: string }>;
}

/** Backstage's team-type vocabulary is `spec.type` on a Group, which is free text but converges on
 * a handful of values. Anything unrecognised becomes stream-aligned — the same default the GitHub
 * importer uses, and for the same reason: a wrong guess a human corrects beats a refusal. */
const TYPE_BY_BACKSTAGE_TYPE: Record<string, string> = {
  team: "stream-aligned",
  "product-area": "stream-aligned",
  "business-unit": "stream-aligned",
  platform: "platform",
  infrastructure: "platform",
  enabling: "enabling",
  "sub-department": "stream-aligned",
  department: "stream-aligned",
};

/** `group:default/payments` → `payments`; a bare `payments` is returned unchanged. */
export function entityRefName(ref: string): string {
  const withoutKind = ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref;
  return withoutKind.includes("/") ? withoutKind.slice(withoutKind.lastIndexOf("/") + 1) : withoutKind;
}

/** Backstage names are already `[a-z0-9A-Z_.-]`; this narrows them to the spec's slug rule. */
export function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "team"
  );
}

function isKind(entity: BackstageCatalogEntity, kind: string): boolean {
  return (entity.kind ?? "").toLowerCase() === kind;
}

/**
 * Bootstraps Team API documents from a Backstage catalog.
 *
 * This is the importer an org that has already done the work needs. A catalog holds exactly the
 * facts a Team API document wants — which groups exist, who is in them, which components they own
 * — and asking someone to retype all of it is the reason a format does not get adopted. The
 * [Backstage generator](../generators/backstage.ts) already goes the other way; this closes the
 * loop.
 *
 * Ownership is read from `spec.owner` on Components and APIs, since that is where Backstage puts
 * it, and cross-checked against `relations[]` when the catalog was processed by a real Backstage
 * (which materialises `ownedBy`/`hasMember` there). Reading both means this works on a raw
 * `catalog-info.yaml` and on the processed entities the catalog API returns, which are different
 * documents that people reasonably expect to behave the same.
 *
 * Everything Backstage has no equivalent for — Team Topologies types beyond the handful its
 * `spec.type` vocabulary maps onto, roles, cognitive load, interactions — comes out empty or
 * defaulted, and is meant to be filled in by hand.
 */
export function importBackstageCatalog(entities: BackstageCatalogEntity[]): ImportedTeam[] {
  const groups = entities.filter((entity) => isKind(entity, "group") && entity.metadata?.name);
  if (groups.length === 0) return [];

  const membersByGroup = new Map<string, Array<{ id: string; name: string; contact?: string }>>();
  for (const group of groups) membersByGroup.set(group.metadata!.name!, []);

  for (const user of entities.filter((entity) => isKind(entity, "user") && entity.metadata?.name)) {
    const name = user.metadata!.name!;
    const groupRefs = [
      ...(user.spec?.memberOf ?? []),
      // `memberOf` is what an author writes; `relations[type=memberOf]` is what the catalog
      // materialises. A processed entity often has only the second.
      ...(user.relations ?? [])
        .filter((relation) => relation.type === "memberOf" && relation.targetRef)
        .map((relation) => relation.targetRef!),
    ];
    for (const ref of new Set(groupRefs.map(entityRefName))) {
      membersByGroup.get(ref)?.push({
        id: toSlug(name),
        name: user.spec?.profile?.displayName ?? user.metadata?.title ?? name,
        ...(user.spec?.profile?.email ? { contact: user.spec.profile.email } : {}),
      });
    }
  }

  const servicesByGroup = new Map<string, Array<{ name: string; repository?: string }>>();
  for (const component of entities.filter((entity) => isKind(entity, "component") || isKind(entity, "api"))) {
    const ownerRef = component.spec?.owner ?? component.relations?.find((r) => r.type === "ownedBy")?.targetRef;
    if (!ownerRef || !component.metadata?.name) continue;
    const owner = entityRefName(ownerRef);
    if (!membersByGroup.has(owner)) continue;

    const sourceLocation = component.metadata.annotations?.["backstage.io/source-location"];
    const repository = sourceLocation?.startsWith("url:") ? sourceLocation.slice(4).replace(/\/+$/, "") : undefined;
    const list = servicesByGroup.get(owner) ?? [];
    list.push({ name: component.metadata.name, ...(repository ? { repository } : {}) });
    servicesByGroup.set(owner, list);
  }

  return groups
    .map((group) => {
      const name = group.metadata!.name!;
      const teamId = toSlug(name);
      const members = (membersByGroup.get(name) ?? []).sort((a, b) => a.id.localeCompare(b.id));
      const services = (servicesByGroup.get(name) ?? []).sort((a, b) => a.name.localeCompare(b.name));

      return {
        teamId,
        document: {
          teamApiVersion: "1.0.0",
          id: teamId,
          info: {
            name: group.metadata?.title ?? name,
            ...(group.metadata?.description ? { focus: group.metadata.description } : {}),
            type: TYPE_BY_BACKSTAGE_TYPE[(group.spec?.type ?? "").toLowerCase()] ?? "stream-aligned",
          },
          roles: [],
          members: members.map((member) => ({ ...member, roleIds: [] })),
          ...(services.length > 0 ? { services } : {}),
        },
      };
    })
    .sort((a, b) => a.teamId.localeCompare(b.teamId));
}
