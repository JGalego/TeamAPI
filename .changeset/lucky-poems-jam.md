---
"@jgalego/teamapi": minor
---

Let `teamapi.config.yml` supply seed patterns and per-command defaults.

The config file introduced for gap waivers now also carries `patterns:` — so the commands run
dozens of times a day lose their argument entirely — and a `defaults:` section for the flags that
are constant for an org: its GitHub login, Okta URL, Paperclip company, serve host/port/CORS/rate
limit. `--org` and `--url` are no longer required flags when the config supplies them.

Precedence is CLI, then config, then built-in default, and command-line patterns replace rather
than merge with the configured ones.

There is deliberately no `token:` key anywhere in the schema — the file lives in the repository,
tokens come from the environment, and the schema rejects the key rather than ignoring it.
