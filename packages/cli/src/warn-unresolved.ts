import type { OrgGraph } from "@jgalego/teamapi-core";

/**
 * Every command builds the graph with `allowPartial: true`, so a broken `$ref` or an
 * invalid team document doesn't stop `render`/`generate`/`serve-api`/`serve-mcp`/`chat` from
 * running — but only `validate` used to actually surface that anything was wrong. Call this
 * right after `buildOrgGraph`/`OrgGraphStore.load()` so every command at least warns (without
 * failing) when it's operating on incomplete data.
 */
export function warnUnresolved(graph: OrgGraph): void {
  if (graph.unresolved.length === 0) return;
  console.error(
    `Warning: ${graph.unresolved.length} unresolved reference(s) — some data may be missing or incomplete. ` +
      "Run `teamapi validate` for details.",
  );
}
