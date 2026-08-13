---
"@jgalego/teamapi": patch
---

Add a scheduled drift-watch action that keeps a single tracking issue in sync with the org-graph
checks.

Pull-request checks only fire when somebody edits a `teamapi.yml`, but most drift is the reverse:
the documents sit still while the org moves around them. `.github/actions/drift` runs `validate`,
`gaps`, and optionally `policy` and `shadow-ai` on a schedule, then opens, updates, or closes one
tracking issue — found by a marker in its body so it survives renaming, and never opened merely to
report that nothing is wrong.
