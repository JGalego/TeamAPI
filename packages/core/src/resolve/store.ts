import { buildOrgGraph, type BuildOrgGraphOptions } from "./graph-builder";
import type { OrgGraph } from "../model/org-graph";

/**
 * Holds a resolved `OrgGraph` for a long-running process (REST/MCP servers): resolves once at
 * startup, exposes the current graph, and supports an explicit `reload()`. Both server adapters
 * and the CLI's `serve-*` commands construct one of these rather than re-resolving independently.
 */
export class OrgGraphStore {
  private graph: OrgGraph | undefined;

  constructor(private readonly options: BuildOrgGraphOptions) {}

  async load(): Promise<OrgGraph> {
    this.graph = await buildOrgGraph(this.options);
    return this.graph;
  }

  async reload(): Promise<OrgGraph> {
    return this.load();
  }

  get current(): OrgGraph {
    if (!this.graph) {
      throw new Error("OrgGraphStore has not been loaded yet — call load() first");
    }
    return this.graph;
  }
}
