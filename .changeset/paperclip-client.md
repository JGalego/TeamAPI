---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Move Paperclip's HTTP out of `paperclip-drift` into a `PaperclipClient`, matching
the other four providers, and add `teamapi doctor paperclip`. Its `verify()`
separates a refused token from a company id that doesn't exist — two outcomes that
need different fixes and previously arrived as the same error. The doctor report
also shows how many running agents carry `metadata.teamapi`, since the rest fall
back to slug matching.
