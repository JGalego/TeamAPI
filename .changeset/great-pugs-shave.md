---
"@jgalego/teamapi-chat": patch
---

Drop the unused `@jgalego/teamapi-schema` dependency. Nothing in the package imported it, so this
removes a transitive install for consumers without changing any behavior.
