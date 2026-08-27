# Roadmap

TeamAPI is pre-1.0 and actively developed. This roadmap communicates direction without attaching dates or promising
that a proposed feature will ship. Priorities change when evaluations, bug reports or provider changes produce better
evidence.

## Now: make evaluations dependable

- Exercise the unified assessment against representative organizations and keep findings actionable.
- Stabilize finding identities, report formats, state files and evidence persistence.
- Harden external integrations around bounded retries, timeouts, pagination and least-privilege behavior.
- Keep the CLI, reusable actions and documentation aligned around one bounded evaluation workflow.

## Next: earn a 1.0 contract

- Resolve feedback from real adoption without expanding the specification prematurely.
- Define and test the public TypeScript, CLI, REST, MCP and document compatibility surfaces needed for 1.0.
- Expand conformance fixtures, migration coverage and performance baselines for larger organizations.
- Improve explanations and remediation guidance where findings are correct but difficult to act on.

A 1.0 release becomes appropriate when the core document model and machine-readable contracts can be supported under
the post-1.0 compatibility policy—not when a calendar date arrives.

## Later: extend from evidence

Potential integrations and checks belong here only after a concrete user workflow demonstrates the need. New provider
support should reuse the shared finding and transport boundaries rather than create a separate control plane.

## Non-goals

- Replacing git, catalogs, identity providers or incident-management systems as their source of truth.
- Building a hosted commercial control plane in this repository.
- Automatically mutating external systems without an explicit, reviewable plan and opt-in execution.
- Modelling every organizational fact before a smaller scope has produced a useful answer.

Requests and evidence are welcome through [GitHub issues](https://github.com/JGalego/TeamAPI/issues). Implementation
guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).
