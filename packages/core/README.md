# @jgalego/teamapi-core

`$ref` resolution, org graph building, cognitive load scoring, DDD context-map derivation, and
Mermaid/DOT diagram generation for the [Team API as Code](https://github.com/JGalego/TeamAPI)
extended spec.

This is the shared engine behind the `teamapi` CLI, the REST API, the MCP server, and the chat
tool-use loop — you normally don't depend on it directly unless you're building another adapter
on top of the same org graph.

## Install

```bash
npm install @jgalego/teamapi-core @jgalego/teamapi-schema
```

## Usage

```ts
import { buildOrgGraph, buildTopologyDiagram, toMermaid } from "@jgalego/teamapi-core";

// seedUris are resolved file paths (expand any globs yourself, e.g. with `fast-glob`)
const graph = await buildOrgGraph({ seedUris: ["./examples/acme-org/stream-checkout/teamapi.yml"] });
console.log(toMermaid(buildTopologyDiagram(graph)));
```

Full docs: **https://github.com/JGalego/TeamAPI**

## License

MIT
