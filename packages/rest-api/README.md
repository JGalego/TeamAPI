# @jgalego/teamapi-rest-api

A read-only [Fastify](https://fastify.dev/) REST API over a resolved
[Team API as Code](https://github.com/JGalego/TeamAPI) org graph — teams, roles, services,
interactions, dependencies, cognitive load, and diagrams, plus interactive Swagger UI at `/docs`.

Normally started via the `teamapi serve-api` CLI command rather than embedded directly, but it's a
plain Fastify plugin if you want to mount it yourself.

## Install

```bash
npm install @jgalego/teamapi-rest-api
```

## Usage

```ts
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { buildServer } from "@jgalego/teamapi-rest-api";

const store = new OrgGraphStore({ seedUris: [...] });
await store.load();
const app = await buildServer(store, { logger: true });
await app.listen({ port: 3000, host: "127.0.0.1" });
```

Full docs, endpoint reference, and examples: **https://github.com/JGalego/TeamAPI**

## License

MIT
