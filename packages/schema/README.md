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

Full docs and the extended spec: **https://github.com/JGalego/TeamAPI**

## License

MIT
