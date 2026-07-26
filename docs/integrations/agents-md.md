# AGENTS.md

An agent opening one of your repositories knows the code and nothing else. Not whose it is, not
what the words mean here, not which decisions the team already made and doesn't want relitigated.
It guesses, plausibly, and a reviewer corrects it — every time, in every repo.

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

## Why this one matters most

Of everything here, this is the AI integration with the widest reach, precisely because it needs
no runtime. No gateway to configure, no server to keep up, no adoption decision by anyone. The
file is already the convention — any coding agent that opens the repository reads it.

Compare [Paperclip](paperclip.md) or the MCP server: both are better at *governed* access, and
both require someone to wire them up first.

## Nothing is summarised

Policies and steering documents are reproduced in the team's own words. That's deliberate: an
agent reading them is reading exactly what a reviewer would quote back in a pull request. A
paraphrase would drift from the thing being enforced, which is the failure this whole project is
about.

The **ubiquitous language** block earns its place at the top for the same reason. It's the
difference between an agent naming a thing the way the team names it and inventing a synonym that
then spreads through the codebase.

## Deliberate limits

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
