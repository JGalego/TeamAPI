---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Fail validation on org-wide name conflicts.

The schema enforces uniqueness within a document, because that is all one document can see. Names
that have to be unique across the whole org — service names, channels — were never checked, so two
teams could both declare `payments-api` and `findServiceOwner` would answer with whichever team id
sorted first. Silently, and for every consumer downstream of it: the REST route, the MCP tool, the
Slack command, generated CODEOWNERS.

`teamapi validate` now reports both claimants and exits non-zero. The tie-break stays — a query
has to return something — but the org no longer has to discover it by noticing that a service it
owns answers with someone else's team.

**Breaking for orgs that currently have duplicates**: validation that passed before will now fail
until the duplicate name is resolved.
