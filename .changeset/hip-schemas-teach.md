---
"@jgalego/teamapi-schema": minor
"@jgalego/teamapi": minor
---

Publish the JSON Schema so editors can validate `teamapi.yml` as you type.

The schema was already derived from the Zod definitions but had no way out of the codebase. It
now has a canonical home at `https://teamapi.dev/schema/v1.json`, a `teamapi schema` command that
prints or writes it, and a `# yaml-language-server: $schema=` modeline on every scaffolded and
bundled document. A test regenerates the published copy and fails when it has drifted, so the
hosted URL can never fall behind the code.
