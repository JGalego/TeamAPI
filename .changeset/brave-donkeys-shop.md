---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `teamapi fmt` — canonical formatting for Team API documents.

Documents edited by hand across an org accumulate their authors' habits about where a section
goes, so two teams adding the same thing produce diffs that look nothing alike. `fmt` orders
top-level keys the way the schema declares them (not alphabetically — the document is meant to be
read top to bottom), keeps unknown keys rather than dropping them, and `--check` fails a build
without writing.

Built on a comment-preserving document tree rather than a load/dump round trip, which would have
deleted every comment in every file it touched. The bundled examples are now canonical and
`pnpm fmt:check` guards them in this repo's own gate.
