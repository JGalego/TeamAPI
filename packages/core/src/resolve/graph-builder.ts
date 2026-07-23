import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatZodError } from "../validate/format-errors";
import { LoaderRegistry } from "./loaders";
import type { GraphEdge, OrgGraph, ResolvedTeam, RoleGraphEdge, UnresolvedRef } from "../model/org-graph";

export interface BuildOrgGraphOptions {
  /** Absolute file paths or URLs to start resolution from. */
  seedUris: string[];
  /** When true, collect failures into `unresolved` instead of throwing. */
  allowPartial?: boolean;
  loaders?: LoaderRegistry;
}

interface PendingEdge {
  targetUri: string;
  build: (toId: string) => GraphEdge;
}

interface PendingRoleEdge {
  targetUri: string;
  kind: RoleGraphEdge["kind"];
  fromTeam: string;
  fromRole: string;
  toRoleId: string;
}

/**
 * Resolves a set of seed Team API documents and every team transitively reachable via `$ref`
 * (in `platform`, `interactions[]`, `dependencies[]` — the fields the spec defines as pointing at
 * other teams' documents; `work.*[].$ref` points at repos/wikis, not team docs, and is not
 * traversed) into a flat `OrgGraph`.
 *
 * Resolution is a BFS worklist over canonical URIs, not recursive inlining: each document is
 * fetched/parsed/validated at most once (tracked by a visited-set), and `$ref`s become edges
 * between flat team nodes rather than nested structures. This means naturally-occurring cycles
 * (Team A's file references Team B, whose file references Team A back) resolve cleanly with no
 * special-casing — there is no recursive structure to loop on.
 */
export async function buildOrgGraph(options: BuildOrgGraphOptions): Promise<OrgGraph> {
  const loaders = options.loaders ?? new LoaderRegistry();
  const allowPartial = options.allowPartial ?? false;

  const visited = new Set<string>();
  const teams = new Map<string, ResolvedTeam>();
  const uriToTeamId = new Map<string, string>();
  const unresolved: UnresolvedRef[] = [];
  const pendingEdges: PendingEdge[] = [];
  const pendingRoleEdges: PendingRoleEdge[] = [];

  const worklist: string[] = [...options.seedUris];

  while (worklist.length > 0) {
    const uri = worklist.shift()!;
    if (visited.has(uri)) continue;
    visited.add(uri);

    let loaded;
    try {
      loaded = await loaders.load(uri);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      unresolved.push({ fromUri: uri, ref: uri, reason });
      if (!allowPartial) throw err;
      continue;
    }

    const parsed = TeamApiDocumentSchema.safeParse(loaded.raw);
    if (!parsed.success) {
      const reason = formatZodError(parsed.error);
      unresolved.push({ fromUri: uri, ref: uri, reason });
      if (!allowPartial) throw new Error(`Invalid Team API document at ${uri}: ${reason}`);
      continue;
    }

    const doc = parsed.data;
    const existing = teams.get(doc.id);
    if (existing && existing.sourceUri !== loaded.canonicalUri) {
      const reason = `Duplicate team id '${doc.id}' declared in both ${existing.sourceUri} and ${loaded.canonicalUri}`;
      unresolved.push({ fromUri: uri, ref: uri, reason });
      if (!allowPartial) throw new Error(reason);
      // Deliberately fall through (not `continue`) even for a rejected duplicate: this document's
      // own outbound $refs are still traversed below, under the original team's id, so a team
      // reachable *only* through the shadowed duplicate doesn't silently vanish from the graph.
    }

    if (!existing) {
      teams.set(doc.id, { id: doc.id, sourceUri: loaded.canonicalUri, doc });
    }
    // Map this specific URI to the team id even when it's a duplicate, so a `$ref` pointing
    // exactly at the duplicate's own file still resolves to the (one) team id in the graph.
    uriToTeamId.set(loaded.canonicalUri, doc.id);

    const enqueue = (ref: string, build: (toId: string) => GraphEdge) => {
      const targetUri = loaders.resolveRef(loaded.canonicalUri, ref);
      worklist.push(targetUri);
      pendingEdges.push({ targetUri, build });
    };

    if (doc.platform) {
      enqueue(doc.platform.$ref, (toId) => ({ kind: "platform", from: doc.id, to: toId }));
    }
    for (const interaction of doc.interactions) {
      enqueue(interaction.$ref, (toId) => ({
        kind: "interaction",
        from: doc.id,
        to: toId,
        mode: interaction.mode,
        contextMappingPattern: interaction.contextMappingPattern,
        purpose: interaction.purpose,
        startDate: interaction.startDate,
      }));
    }
    for (const dependency of doc.dependencies) {
      enqueue(dependency.$ref, (toId) => ({
        kind: "dependency",
        from: doc.id,
        to: toId,
        type: dependency.type,
        description: dependency.description,
      }));
    }

    const enqueueRole = (ref: string, kind: RoleGraphEdge["kind"], fromRole: string, toRoleId: string) => {
      const targetUri = loaders.resolveRef(loaded.canonicalUri, ref);
      worklist.push(targetUri);
      pendingRoleEdges.push({ targetUri, kind, fromTeam: doc.id, fromRole, toRoleId });
    };

    for (const role of doc.roles) {
      if (role.reportsToRef) {
        enqueueRole(role.reportsToRef.$ref, "reports-to", role.id, role.reportsToRef.roleId);
      }
      for (const align of role.alignsWith) {
        enqueueRole(align.$ref, "aligns-with", role.id, align.roleId);
      }
    }
  }

  const edges: GraphEdge[] = [];
  for (const pending of pendingEdges) {
    const toId = uriToTeamId.get(pending.targetUri);
    if (!toId) {
      unresolved.push({
        fromUri: pending.targetUri,
        ref: pending.targetUri,
        reason: "Referenced document could not be resolved into a team",
      });
      continue;
    }
    edges.push(pending.build(toId));
  }

  const roleEdges: RoleGraphEdge[] = [];
  for (const pending of pendingRoleEdges) {
    const toTeamId = uriToTeamId.get(pending.targetUri);
    if (!toTeamId) {
      unresolved.push({
        fromUri: pending.targetUri,
        ref: pending.targetUri,
        reason: "Referenced document could not be resolved into a team",
      });
      continue;
    }
    const toTeam = teams.get(toTeamId)!;
    const roleExists = toTeam.doc.roles.some((r) => r.id === pending.toRoleId);
    if (!roleExists) {
      unresolved.push({
        fromUri: pending.targetUri,
        ref: pending.targetUri,
        reason: `Role '${pending.toRoleId}' not found on team '${toTeamId}' (referenced by ${pending.fromTeam}.${pending.fromRole})`,
      });
      continue;
    }
    roleEdges.push({
      kind: pending.kind,
      fromTeam: pending.fromTeam,
      fromRole: pending.fromRole,
      toTeam: toTeamId,
      toRole: pending.toRoleId,
    });
  }

  return {
    teams,
    edges,
    roleEdges,
    unresolved,
    meta: { resolvedAt: new Date().toISOString(), sourceRoots: options.seedUris },
  };
}
