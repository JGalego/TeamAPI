# @jgalego/teamapi-schema

Zod schemas and inferred TypeScript types for the
[Team API as Code extended spec](https://github.com/JGalego/TeamAPI/blob/main/docs/spec/teamapi-extended-v1.md)
— roles, members, services, bounded contexts, interactions, dependencies, cognitive load
assessments, and the root `TeamApiDocument`.

## Install

```bash
npm install @jgalego/teamapi-schema
```

## Usage

```ts
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";

const doc = TeamApiDocumentSchema.parse(yourParsedYaml);
```

## Exports

- `TeamApiDocumentSchema` / `TeamApiDocument` — the root document schema and its inferred type.
- `v1` — namespace re-export of every `v1/*` schema/type (`RoleSchema`, `ServiceSchema`,
  `InteractionSchema`, `DependencySchema`, `CognitiveLoadAssessmentSchema`, `WorkSchema`,
  `MeetingSchema`, `ChannelSchema`, `SearchTermSchema`, etc.) for consumers that need a specific
  sub-schema or type rather than the whole document.
- `getTeamApiJsonSchema()` — the same schema as plain JSON Schema, for editors/IDEs or non-Zod
  consumers.
- `SCHEMA_REGISTRY`, `isSupportedVersion(version)`, `resolveSchemaForVersion(version)` — a
  forward-compatibility seam for validating a document against whichever `teamApiVersion` schema
  it declares; currently only `"1.0.0"` is registered.
- `SUGGESTED_ROLE_KINDS` — a non-exhaustive list of common `roles[].kind` values, offered for
  editor autocompletion (`roles[].kind` itself accepts any non-empty string).
- `responsibilityText(responsibility)` / `responsibilityDoneWhen(responsibility)` — helpers for
  reading a `Role.responsibilities[]` entry regardless of whether it's the plain-string or
  `{ text, doneWhen }` object form.

## Validation beyond field types

A few cross-field rules are enforced at parse time, not just field shapes:

- A role's `reportsTo` and `reportsToRef` are mutually exclusive.
- A role's `reportsTo` must match another role's `id` within the same team, and same-team
  `reportsTo` cycles (including self-reports) are rejected.
- `roles[].id` and `members[].id` must each be unique within a team.

Full docs and the extended spec: **https://github.com/JGalego/TeamAPI**

## License

MIT
