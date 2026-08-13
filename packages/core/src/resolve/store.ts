import { buildOrgGraph, type BuildOrgGraphOptions } from "./graph-builder";
import type { OrgGraph } from "../model/org-graph";

/**
 * Holds a resolved `OrgGraph` for a long-running process (REST/MCP servers): resolves once at
 * startup, exposes the current graph, and supports an explicit `reload()`. Both server adapters
 * and the CLI's `serve-*` commands construct one of these rather than re-resolving independently.
 */
export class OrgGraphStore {
  private graph: OrgGraph | undefined;
  private options: BuildOrgGraphOptions;

  constructor(options: BuildOrgGraphOptions) {
    this.options = options;
  }

  /**
   * Resolves the graph and, only on success, publishes it.
   *
   * The assignment deliberately happens after the `await`, not around it: a reload that throws —
   * a document saved mid-write, a `$ref` pointing at a file that briefly doesn't exist — leaves
   * the previously resolved graph in place for readers. A server answering from a slightly stale
   * org is always more useful than one answering from a half-parsed one.
   */
  async load(seedUris?: string[]): Promise<OrgGraph> {
    if (seedUris) this.options = { ...this.options, seedUris };
    this.graph = await buildOrgGraph(this.options);
    return this.graph;
  }

  /** Re-resolves, optionally against a freshly discovered set of seeds — so a team document added
   * after startup is picked up, not just edits to the ones that existed then. */
  async reload(seedUris?: string[]): Promise<OrgGraph> {
    return this.load(seedUris);
  }

  get current(): OrgGraph {
    if (!this.graph) {
      throw new Error("OrgGraphStore has not been loaded yet — call load() first");
    }
    return this.graph;
  }
}
