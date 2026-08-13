---
"@jgalego/teamapi": minor
---

Add `teamapi init` — scaffold a whole org repository, not one document.

`scaffold` produced a single team and left open every decision that actually stands between
trying this and using it: where documents live, how CI runs them, how an editor validates them.
`init` makes those decisions, consistently with what every command already defaults to.

It writes `teamapi.config.yml` (so every command works with no arguments), a CI workflow wired to
the bundled action, VS Code settings binding the documents to the published schema, a README, and
a first stream-aligned and platform team.

The workflow's gating checks ship commented out: a new org has no gaps, and a check that turned
red on the day its documents first described a real one is a check that gets deleted. It refuses
to overwrite by default, naming every file it would have replaced rather than stopping at the
first.
