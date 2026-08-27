# @jgalego/teamapi-chat

## 0.3.2

### Patch Changes

- Updated dependencies [214b393]
  - @jgalego/teamapi-core@0.10.0

## 0.3.1

### Patch Changes

- Updated dependencies [b6b668f]
- Updated dependencies [6d0296a]
- Updated dependencies [15a86ad]
- Updated dependencies [7a57e8a]
- Updated dependencies [dbc711d]
- Updated dependencies [1e40e3a]
- Updated dependencies [7b88c09]
- Updated dependencies [5367863]
- Updated dependencies [f9c29ca]
- Updated dependencies [ca65ddf]
  - @jgalego/teamapi-core@0.9.0

## 0.3.0

### Minor Changes

- 81e6c7b: Chat is no longer hardwired to one vendor. `ChatTool` is a provider-neutral tool definition, `createChatSession` picks an adapter, and `--provider openai --base-url ...` reaches any OpenAI-compatible server (Azure, Ollama, vLLM, Together, Groq, OpenRouter, …) with no vendor SDK. `teamapi chat --ask "<question>"` runs one turn, prints the answer on stdout with everything else on stderr, and exits 2 if the answer is incomplete.

### Patch Changes

- Updated dependencies [36e83c6]
- Updated dependencies [543da37]
- Updated dependencies [d4d0372]
- Updated dependencies [ec29a2c]
- Updated dependencies [41f5fe3]
- Updated dependencies [f41844d]
- Updated dependencies [6152e09]
- Updated dependencies [9f25986]
- Updated dependencies [23c56b3]
- Updated dependencies [7bfb3d1]
- Updated dependencies [eca4cde]
- Updated dependencies [b6b5a86]
- Updated dependencies [6d7b1e9]
- Updated dependencies [0d6d857]
- Updated dependencies [54f0325]
- Updated dependencies [a713d92]
  - @jgalego/teamapi-core@0.8.0

## 0.2.0

### Minor Changes

- 2ec4c6c: Serve `teamapi gaps` over HTTP and MCP, and link agents to the humans accountable for them.

  - **`GET /gaps`**, the **`get_org_gaps`** MCP tool, and a matching chat tool. `gaps` is a pure
    function of the resolved graph with no token and no I/O — the same shape as `/cognitive-load` —
    so unlike the drift checks there is no reason it should be CLI-only. An assistant asking "what is
    nobody responsible for here?" can now compute the answer instead of waiting for a CI log.
  - **`accountableFor`** (member → agent) in the knowledge graph, resolved from `agents[].ownerId`.
    Emitted only when the id resolves to a declared member: a dangling `ownerId` is `gaps`'s blocking
    `dangling-owner` finding, and drawing an edge to a person who isn't there would launder exactly
    the false impression of accountability that finding exists to catch.
  - The knowledge graph's role-edge relations gain `advises`/`learnsFrom`/`communityOfPractice`,
    matching the informal `alignsWith[].kind` values.

### Patch Changes

- fefe0b2: Drop the unused `@jgalego/teamapi-schema` dependency. Nothing in the package imported it, so this
  removes a transitive install for consumers without changing any behavior.
- Updated dependencies [7ca7e0c]
- Updated dependencies [dcbfdda]
- Updated dependencies [e676027]
- Updated dependencies [1f2a3a4]
- Updated dependencies [fa1ff63]
- Updated dependencies [2ec4c6c]
- Updated dependencies [a7ecce1]
- Updated dependencies [1d96a38]
  - @jgalego/teamapi-core@0.7.0

## 0.1.7

### Patch Changes

- Updated dependencies [ca583e4]
- Updated dependencies [6c77ac6]
- Updated dependencies [ee64909]
- Updated dependencies [c411166]
- Updated dependencies [42d5982]
- Updated dependencies [551234a]
- Updated dependencies [6eff7a3]
- Updated dependencies [9c426a5]
- Updated dependencies [1f8b769]
- Updated dependencies [fe754b3]
- Updated dependencies [e96acc8]
  - @jgalego/teamapi-core@0.6.0

## 0.1.6

### Patch Changes

- ed56c2e: Stop shipping each package's own compiled test suite (`dist/__tests__/**`) in the published npm tarball — `tsc -b` was compiling `src/**/*.test.ts` alongside real source since nothing excluded it, and `"files": ["dist"]` then published the result. Cuts `@jgalego/teamapi-core`'s published file count by about 40% with no change in behavior; `pnpm test` is unaffected since Vitest runs the `.ts` sources directly rather than the built output.

  Rename a local variable in the CrewAI generator from `process` to `crewProcess` (the object's `process` field, matching CrewAI's own config shape, is unchanged) — a variable literally named `process` was tripping supply-chain scanners' "environment variable access" heuristic even though this code never touches `process.env` or any other global.

- Updated dependencies [ed56c2e]
  - @jgalego/teamapi-schema@0.4.1
  - @jgalego/teamapi-core@0.5.1

## 0.1.5

### Patch Changes

- Updated dependencies [b3c64e3]
  - @jgalego/teamapi-schema@0.4.0
  - @jgalego/teamapi-core@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [dbf75f6]
- Updated dependencies [b73cbfd]
  - @jgalego/teamapi-schema@0.3.0
  - @jgalego/teamapi-core@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [df017b2]
- Updated dependencies [1a5ce98]
  - @jgalego/teamapi-core@0.3.0

## 0.1.2

### Patch Changes

- caebd20: Fixes from a full code + docs review:
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

- Updated dependencies [caebd20]
- Updated dependencies [82bbad4]
  - @jgalego/teamapi-schema@0.2.0
  - @jgalego/teamapi-core@0.2.0

## 0.1.1

### Patch Changes

- e7703e1: Add a README to each published package so it renders on the npm listing page instead of showing "This package does not have a README."
- Updated dependencies [e7703e1]
  - @jgalego/teamapi-core@0.1.1
  - @jgalego/teamapi-schema@0.1.1
