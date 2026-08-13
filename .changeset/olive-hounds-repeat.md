---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Check declared `policies[]` against the org graph with `teamapi policy`.

Policies were declared but never evaluated — the schema said "external automation enforces this"
and nothing verified that any such automation existed. The new engine decides every rule it can
from the graph alone (agent bans and caps, owner requirements, provider allow-lists, cognitive
load ceilings, required steering/playbook categories, service repository and bounded-context
requirements, dependency caps), reports rules it can't as `delegated` when `enforcedBy` names an
enforcer, and — the point of the exercise — reports them as `unenforced` when nothing does.

A blocking policy that nothing enforces now exits non-zero, as does a violated one. Available in
CI via `check-policies: true` on the bundled action.
