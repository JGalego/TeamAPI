# AGENTS.md

An agent opening one of your repositories sees the code but lacks its ownership, local vocabulary,
and settled team decisions. It makes plausible guesses that reviewers must correct in every
repository.

The team that owns the service has already written all of it down.

```bash
teamapi generate agents-md /path/to/your/org --out ./agents
```

## What it writes

One file per repository, at the path it belongs to:

```text
agents/acme/checkout-api/AGENTS.md
agents/acme/ledger/AGENTS.md
```

```markdown
# checkout-api — owned by Stream Checkout

Shopping cart, checkout flow, and order placement

## Who owns this

**Stream Checkout** (`stream-checkout`), a stream-aligned team. Ask in #stream-checkout.

## Ubiquitous language

- **Cart** — An in-progress, unpaid order
- **Order** — A cart that has been placed and paid for

## Domain events

Publishes: OrderPlaced

Subscribes to: ApplicantActivated, ChargeAuthorized

## Policies

- **No autonomous AI agents on applicant PII** (blocking) — Applicant data is regulated PII…

## How this team works

### Trunk-based development

…
```

Sections a team has nothing for are omitted rather than left as empty headings.

## Reach

This AI integration reaches the most repositories because it needs no runtime, gateway, or server.
Coding agents already look for the file when they open a repository.

Compare [Paperclip](paperclip.md) or the MCP server: both are better at _governed_ access, and
both require someone to wire them up first.

## Nothing is summarised

Policies and steering documents are reproduced in the team's own words. The agent sees exactly
what a reviewer would quote in a pull request, avoiding the drift introduced by a paraphrase.

The **ubiquitous language** block appears near the top so the agent uses the team's names instead
of spreading an invented synonym through the codebase.

## Limits

- **A repo claimed by two teams gets no file.** Two teams' policies rendered into one document
  would read as one team's. Same call [CODEOWNERS](codeowners.md) makes, and the command exits
  non-zero for the same reason.
- **Services with no `repository` are skipped** and named in the output.
- **The file is overwritten.** It says so in its last section. Edits belong in `teamapi.yml`,
  in a pull request, where they get reviewed like any other org change.

## Suggested loop

1. Declare `services[].repository`, `boundedContext`, `policies[]` and `steeringDocuments[]`.
2. `teamapi generate agents-md` on merge, and open a pull request per repository.
3. Agents pick it up with no further setup, because they already look for the file.
