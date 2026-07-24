import type { ContextMappingPattern, InteractionMode } from "@jgalego/teamapi-schema";

/**
 * Heuristic mapping from a Team Topologies interaction mode to a suggested DDD context-mapping
 * pattern, used only when a team hasn't set an explicit `contextMappingPattern`.
 *
 * `facilitating` is deliberately absent: it's a temporary coaching/enabling relationship, not a
 * runtime integration, so it gets no auto-derived pattern unless a team is explicit about it.
 */
export const MODE_TO_PATTERN_HEURISTIC: Partial<Record<InteractionMode, ContextMappingPattern>> = {
  "x-as-a-service": "OpenHostService",
  collaboration: "Partnership",
};
