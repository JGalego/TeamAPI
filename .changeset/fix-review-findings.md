---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": patch
"@jgalego/teamapi-rest-api": patch
"@jgalego/teamapi-mcp-server": minor
"@jgalego/teamapi-chat": patch
---

Fixes from a full code + docs review:

- **schema**: enforce previously-undocumented-but-unenforced rules — `roles[].id`/`members[].id`
  uniqueness, `reportsTo` must reference an existing role and can't form a cycle (including
  self-reports), `reportsTo`/`reportsToRef` are now genuinely mutually exclusive, and `x-*` vendor
  extension fields are preserved on `platform`/`reportsToRef`/`alignsWith[]` refs (previously
  silently stripped).
- **core**: `detectConflicts` now also flags disagreeing `contextMappingPattern` declarations, not
  just disagreeing `mode`; a duplicate team id's own outbound `$ref`s are now still traversed so a
  team reachable only through the duplicate doesn't silently vanish from the graph;
  `findServiceOwner` picks a deterministic (alphabetically-first) owner when service names collide
  instead of an arbitrary graph-traversal-order one; fixed `HttpLoader.resolveUri` throwing
  "Invalid URL" when a local file references an absolute `https://` `$ref` directly; added
  `toOrgGraphDto` as the single shared serializer for "the full org graph" (now includes
  `roleEdges`, previously omitted from both REST's `/graph` and MCP's `get_org_graph`).
- **cli**: `teamapi render`'s `--scope`/`--format` and `teamapi scaffold`'s `--type` now reject
  invalid values instead of silently falling back to a default; `--team` validation is now
  consistent across every `render` scope; `--port` is now validated as 1-65535; every command now
  warns (without failing) when the graph has unresolved references, not just `validate`;
  `teamapi chat` now caps tool-call iterations per turn, surfaces non-`end_turn` stop reasons
  instead of silently printing an empty/truncated reply, and shows minimal tool-call progress
  outside `--debug`; `--version` and `--model`'s default now track the real package
  version/`DEFAULT_CHAT_MODEL` instead of a hardcoded literal.
- **rest-api**: `/graph` now includes `roleEdges`; added 400/404 response schemas to the OpenAPI
  spec; fixed `/search`'s inconsistent error body for a missing vs. empty `q`; the OpenAPI
  `info.version` now tracks the package's real version.
- **mcp-server**: added a `get_team_dependencies` tool (previously only reachable via REST);
  `get_org_graph` now includes `roleEdges`; `find_service_owner`'s exact-match semantics are now
  disclosed in its description and error message; the reported server `version` now tracks the
  real package version instead of a hardcoded literal.
- **chat**: pinned `zod` back to the same range as every sibling package (was on a different major
  than `core`/`schema`/`mcp-server`), while keeping `betaZodTool` working correctly by importing
  the `zod/v4` subpath explicitly — zod 3.25+ bundles both APIs in one package, so this eliminates
  two coexisting zod majors in the workspace without breaking the Anthropic SDK's zod helper.
