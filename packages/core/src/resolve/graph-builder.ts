import { assessVersion, TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatZodError } from "../validate/format-errors";
import { LoaderRegistry, type LoadedDocument, type LoaderRegistryOptions } from "./loaders";
import type { GraphEdge, OrgGraph, ResolvedTeam, RoleGraphEdge, UnresolvedRef } from "../model/org-graph";

export interface BuildOrgGraphOptions {
  /** Absolute file paths or URLs to start resolution from. */
  seedUris: string[];
  /** When true, collect failures into `unresolved` instead of throwing. */
  allowPartial?: boolean;
  loaders?: LoaderRegistry;
  /** On-disk cache for `https://` refs, for callers that do not build their own `LoaderRegistry`.
   * Ignored when `loaders` is supplied, which already carries its own. */
  cache?: LoaderRegistryOptions["cache"];
  /**
   * How many documents may be in flight at once. Every document in a BFS level is loaded
   * concurrently up to this many; the default suits a remote org, where the wall clock is
   * round-trip time rather than anything this process does.
   *
   * Lower it for a server that must not open dozens of sockets at once; `1` restores strictly
   * serial loading, which is occasionally what a rate-limited host wants.
   */
  concurrency?: number;
}

/** High enough that a wide level of remote `$ref`s overlaps properly, low enough not to look like
 * a burst to whatever is serving them. */
const DEFAULT_CONCURRENCY = 8;

/** Runs `worker` over `items` with at most `limit` in flight, preserving input order in the
 * result. Order matters: the whole point of loading concurrently but *processing* in order is that
 * two runs over the same seeds produce identical graphs. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

interface PendingEdge {
  sourceUri: string;
  targetUri: string;
  build: (toId: string) => GraphEdge;
}

/** One document's load attempt. A discriminated union rather than a thrown rejection: a rejected
 * promise inside the concurrent map would abandon the rest of the level mid-flight, and an
 * `allowPartial` caller needs every failure reported, not the first one. */
type LevelLoad = { uri: string; loaded: LoadedDocument } | { uri: string; error: unknown };

interface PendingRoleEdge {
  sourceUri: string;
  targetUri: string;
  kind: RoleGraphEdge["kind"];
  fromTeam: string;
  fromRole: string;
  toRoleId: string;
}

/** The version-specific explanation for a document the schema rejected, when the reason it was
 * rejected is its `teamApiVersion` rather than anything else about it. */
function versionAdvice(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const assessment = assessVersion(raw as Record<string, unknown>);
  return assessment.status === "current" ? undefined : assessment.advice;
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
 *
 * A whole BFS level is loaded at once and then processed in order. Loading is I/O and the levels
 * of an org graph are wide — every team a platform team serves sits on one level — so awaiting
 * them one at a time made resolution time the *sum* of every round trip rather than the sum of the
 * slowest per level. Processing stays strictly ordered even though loading does not, because
 * first-writer-wins decisions (which document owns a duplicated team id, which unresolved
 * references are reported and in what order) must not depend on which fetch happened to return
 * first — two runs over the same seeds produce byte-identical graphs.
 */
export async function buildOrgGraph(options: BuildOrgGraphOptions): Promise<OrgGraph> {
  const loaders = options.loaders ?? new LoaderRegistry({ cache: options.cache });
  const allowPartial = options.allowPartial ?? false;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const visited = new Set<string>();
  const teams = new Map<string, ResolvedTeam>();
  const uriToTeamId = new Map<string, string>();
  const unresolved: UnresolvedRef[] = [];
  const pendingEdges: PendingEdge[] = [];
  const pendingRoleEdges: PendingRoleEdge[] = [];

  let worklist: string[] = [...options.seedUris];

  while (worklist.length > 0) {
    // Deduplicate within the level as well as against previous levels: two teams on the same level
    // referencing the same platform team must not fetch it twice.
    const level: string[] = [];
    for (const uri of worklist) {
      if (visited.has(uri)) continue;
      visited.add(uri);
      level.push(uri);
    }
    worklist = [];
    if (level.length === 0) break;

    const loads = await mapWithConcurrency<string, LevelLoad>(level, concurrency, async (uri) => {
      try {
        return { uri, loaded: await loaders.load(uri) };
      } catch (error) {
        return { uri, error };
      }
    });

    for (const result of loads) {
      const uri = result.uri;
      if ("error" in result) {
        const reason = result.error instanceof Error ? result.error.message : String(result.error);
        unresolved.push({ fromUri: uri, ref: uri, reason });
        if (!allowPartial) throw result.error;
        continue;
      }
      const loaded = result.loaded;

      const parsed = TeamApiDocumentSchema.safeParse(loaded.raw);
      if (!parsed.success) {
        // A version mismatch produces `teamApiVersion: Invalid literal value, expected "1.0.0"`,
        // which is true and useless: it reads identically whether the document predates this build
        // or postdates it, and those need opposite responses from the reader — edit the file, or
        // upgrade the toolchain. Ask the version machinery, which can tell them apart.
        const reason = versionAdvice(loaded.raw) ?? formatZodError(parsed.error);
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
        pendingEdges.push({ sourceUri: loaded.canonicalUri, targetUri, build });
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
        pendingRoleEdges.push({
          sourceUri: loaded.canonicalUri,
          targetUri,
          kind,
          fromTeam: doc.id,
          fromRole,
          toRoleId,
        });
      };

      for (const role of doc.roles) {
        if (role.reportsToRef) {
          enqueueRole(role.reportsToRef.$ref, "reports-to", role.id, role.reportsToRef.roleId);
        }
        for (const align of role.alignsWith) {
          enqueueRole(align.$ref, align.kind ?? "aligns-with", role.id, align.roleId);
        }
      }
    }
  }

  const edges: GraphEdge[] = [];
  for (const pending of pendingEdges) {
    const toId = uriToTeamId.get(pending.targetUri);
    if (!toId) {
      unresolved.push({
        fromUri: pending.sourceUri,
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
        fromUri: pending.sourceUri,
        ref: pending.targetUri,
        reason: "Referenced document could not be resolved into a team",
      });
      continue;
    }
    const toTeam = teams.get(toTeamId)!;
    const roleExists = toTeam.doc.roles.some((r) => r.id === pending.toRoleId);
    if (!roleExists) {
      unresolved.push({
        fromUri: pending.sourceUri,
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
