---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

`buildOrgHierarchyDiagram` takes an optional `{ includeAgents }`, exposed as
`teamapi render --scope org-hierarchy --with-agents`: each team's declared `agents[]` is drawn
hanging off the human whose `ownerId` names them, by a dotted "supervises" edge.

Agents appear as participants but never as boxes in the chart. An agent placed in the hierarchy
the way a person is would suggest accountability sits with it, when it never does — so an agent
with no resolvable owner gets no incoming edge and visibly floats, which is exactly what an unowned
agent is. Paused agents are labelled with their status rather than hidden.

Off by default, so every existing render — including the Mermaid committed in the README — is
byte-identical.
