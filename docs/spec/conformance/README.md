# Spec conformance fixtures

Executable proof that the implementation does what
[`../teamapi-extended-v1.md`](../teamapi-extended-v1.md) says it does.

The spec is a hand-written mirror of the Zod schema and the resolver. A mirror drifts — a
[prior review](../../reviews/2026-07-23-code-docs-review.md) caught it having drifted already — and
the failure is quiet in both directions: a spec that promises a rule nothing enforces, and an
implementation that enforces a rule the spec never mentions. Both look fine until someone writes a
document against the wrong half.

Each file here is one normative statement, its documents, and its expected outcome. The runner is
[`packages/core/src/__tests__/spec-conformance.test.ts`](../../../packages/core/src/__tests__/spec-conformance.test.ts),
which also checks the parts of the spec that are tables rather than behaviour — the enum reference
and the list of `$ref` fields the resolver traverses are read out of the markdown and compared
against the schema and the resolver themselves.

## Fixture format

```yaml
# Which section of the spec this comes from, verbatim — the runner asserts the heading exists.
clause: Role
# The normative statement being pinned, in the spec's own words where possible.
requirement: reportsTo and reportsToRef are mutually exclusive.
# Documents, keyed by path relative to the fixture's temporary root. Written out to a temp
# directory so relative `$ref`s resolve exactly as they do on disk.
files:
  team-a/teamapi.yml: |
    teamApiVersion: "1.0.0"
    ...
# Which files to resolve from. Defaults to every file listed above.
seeds: [team-a/teamapi.yml]
expect:
  # "resolved" or "rejected".
  outcome: rejected
  # For `rejected`: a substring the failure must contain, so the fixture pins the *diagnosis* and
  # not merely the fact that something went wrong.
  reasonContains: mutually exclusive
```

For `outcome: resolved`, any of these may be asserted:

| Key                        | Meaning                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `teams`                    | Exact sorted list of resolved team ids.                                           |
| `edges`                    | Exact sorted list of `kind from -> to` strings.                                   |
| `roleEdges`                | Exact sorted list of `kind fromTeam.fromRole -> toTeam.toRole` strings.           |
| `unresolved`               | Exact number of unresolved references. Defaults to 0, so it is always checked.    |
| `unresolvedReasonContains` | Substring one of the unresolved reasons must contain.                             |
| `passthrough`              | Vendor-extension fields the first resolved document must still carry.             |
| `contextMap`               | Exact list of `from -> to mode pattern (source)` strings from `deriveContextMap`. |
| `contextMapConflicts`      | Exact number of context-map conflicts.                                            |

## Adding one

Write the fixture, run `pnpm --filter @jgalego/teamapi-core test`. There is no registration step:
the runner reads the directory, and asserts it is non-empty so an empty directory can never pass as
a green suite.
