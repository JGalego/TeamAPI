---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi gaps`, which reports accountability holes between teams rather than inside any one of
them: subscriptions to events nothing publishes, agents whose `ownerId` names nobody on the team,
vacant roles other teams report into, and one-sided collaborations. `planGaps`/`formatGaps` are
exported from core. Only `orphan-subscription` and `dangling-owner` exit non-zero, so it can gate a
required check without ordinary findings failing a build; `teamapi gaps examples/acme-org` reports
four warnings and exits 0.

Ships `examples/driftwood-org`, an org that validates cleanly but is deliberately built to fail the
new check. It is a second test fixture alongside `acme-org`, which `CONTRIBUTING.md` normally
discourages — a broken org can't live inside the one every other example renders from without
breaking those examples.
