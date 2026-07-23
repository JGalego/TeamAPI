# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately rather than opening a public GitHub issue.

Use GitHub's [private vulnerability reporting](https://github.com/JGalego/TeamAPI/security/advisories/new)
for this repository. Include what you found, how to reproduce it, and its potential impact — a
minimal `teamapi.yml`/CLI invocation that demonstrates the issue is ideal.

## Scope and known-by-design tradeoffs

This toolchain (`@jgalego/teamapi-rest-api`, `@jgalego/teamapi-mcp-server`) is built for exploring
org data you already trust (your own `teamapi.yml` files), not for exposure to untrusted input or
untrusted networks:

- **The REST API is unauthenticated by design.** There is no auth, CORS policy, or rate limiting.
  `teamapi serve-api` binds to `127.0.0.1` only by default — do not bind it beyond localhost
  without putting an authenticating reverse proxy in front of it.
- **`GET /graph` and `get_org_graph` can reveal local filesystem paths and loader error text**
  (e.g. `meta.sourceRoots`, `unresolved[].reason`) to anyone who can reach the API — acceptable for
  a local dev tool, not for an API exposed beyond that.
- **`teamapi chat`'s system prompt is built by directly interpolating org YAML fields** (team
  name, focus, role names) with no sanitization. If your `teamapi.yml` files are ever sourced from
  less-trusted contributors, treat this as a prompt-injection surface.

If you find a genuine vulnerability within this scope (e.g. something that breaks the REST API's
read-only guarantee, or a way to make it write outside the CLI's `--out` files), please report it
per the process above rather than filing a public issue.
