# Compatibility policy

TeamAPI is a set of independently versioned npm packages plus a versioned document specification. This policy
separates those contracts: installing a new CLI package does not silently rewrite a document, and a document's
`teamApiVersion` does not imply a particular server package version.

## Current stability

The packages are pre-1.0. Minor releases may still contain breaking changes where preserving the old behavior would
prevent the project from reaching a coherent 1.0 API. Such changes must be called out in the affected package's
changelog and should include migration guidance.

The `1.0.0` Team API document format is already an explicit contract. Optional fields may be added compatibly. A
change that invalidates a previously valid document requires a new document version and a `teamapi migrate` path.

## Package versions

Each package follows semantic versioning independently:

- Patch: compatible fixes and documentation.
- Minor before 1.0: new features and, when unavoidable, announced breaking changes.
- Major after 1.0: breaking public API or behavior changes.

Workspace dependencies are updated by Changesets when required. Consumers should not assume all TeamAPI packages
share one version number.

## CLI contract

Command names, exit-code meaning and documented options are compatibility surfaces. New optional flags can be added
without a breaking release. Removing or changing a flag requires a changelog notice and, where practical, one minor
release that accepts both forms.

Human-readable text is intended for people and may improve between releases. Automation should use JSON or SARIF.

## Machine-readable reports

Versioned report objects carry a numeric `version`:

- Normalized findings: version `1`
- Assessment reports: version `1`
- Assessment state: version `1`
- Evidence ledger documents: version `1`

Within one version, fields may be added but existing fields do not change meaning or type. Consumers should ignore
unknown fields. Removing or redefining a field requires a new format version. State loaders reject unknown versions
rather than guessing.

Finding `id` values are deterministic identities. Their prose and severity may evolve, but an unchanged underlying
problem keeps the same ID. Rule IDs are never reused for a different condition. A renamed or substantially redefined
rule receives a new ID.

## REST and MCP

Additive routes, response fields and tools are compatible. Clients must ignore unknown response fields. Removing or
renaming a route, required field, MCP tool or tool argument is breaking after 1.0 and requires a deprecation period
before then.

The REST server intentionally emits the complete domain objects instead of maintaining a second hand-written
response model. Its package version and OpenAPI document identify the implementation being served.

## Integrations

Provider APIs change independently of TeamAPI. The project treats constructor options, public methods and returned
TeamAPI types as its contract; provider error wording is not stable. Permission requirements and externally visible
side effects must be documented for every write operation.

## Runtime support

The supported runtime is declared in each package's `engines` field. Dropping a Node major version requires at least
a minor release before 1.0 and a major release after 1.0.

## Deprecation process

A deprecation must include:

1. A changelog entry naming the replacement.
2. Documentation showing both the old and new forms during the transition.
3. A warning where one can be emitted without corrupting machine-readable output.
4. Removal no earlier than the release announced in the deprecation notice.

Security fixes may shorten this process when retaining the behavior would expose users to material risk.
