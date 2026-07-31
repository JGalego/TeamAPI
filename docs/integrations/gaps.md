# Gaps

Every other check in this toolchain compares the spec to an outside system — a directory, a pager,
a running agent fleet. `teamapi gaps` compares the spec to itself, because the holes it looks for
are invisible from any single `teamapi.yml`.

That is the point. Each team's document is individually valid; the gap only appears once the graph
is resolved. A service subscribing to an event nobody publishes reads as complete from inside the
subscriber. A vacant seat reads as an ordinary staffing question from inside the team that declared
it — it is the two _other_ teams reporting into it that make the vacancy load-bearing. Nobody owns
the space between the boxes, so nobody was ever going to notice.

```bash
teamapi gaps examples/acme-org
```

## What it reports

```text
- unconsumed-event: 'ledger' publishes 'LedgerEntryPosted', which no declared service subscribes to
- unconsumed-event: 'checkout-api' publishes 'OrderPlaced', which no declared service subscribes to
? vacant-load-bearing: 'head-of-engineering' on platform-payments is vacant, but stream-checkout, stream-onboarding report(s) into it
~ unacknowledged: stream-checkout declares a collaboration with stream-onboarding, which declares nothing back

4 finding(s), 0 blocking; 9 seam(s) checked.
```

| finding                | meaning                                                        | blocking |
| ---------------------- | -------------------------------------------------------------- | -------- |
| `orphan-subscription`  | a service subscribes to an event no declared service publishes | **yes**  |
| `dangling-owner`       | an agent's `ownerId` names nobody in that team's `members[]`   | **yes**  |
| `unconsumed-event`     | a service publishes an event no declared service subscribes to | no       |
| `vacant-load-bearing`  | a vacant role another team's reporting line terminates in      | no       |
| `unacknowledged`       | a `collaboration` the other team declares nothing back about   | no       |
| `unaccountable-agent`  | an `agents[]` entry naming no `ownerId` at all                 | no       |
| `unscored-supervision` | active agents, but no `cognitiveLoad.supervision` score        | no       |

**Two findings exit non-zero, and they have the same shape as each other:** the declaration _looks_
complete and isn't. This is the argument [`okta.md`](okta.md) makes about deactivated accounts —
the dangerous finding is never the missing name, it is the name that is still there.

An agent carrying an `ownerId` that resolves to nobody presents, to every downstream consumer —
`AGENTS.md`, the context bundle, a generated CrewAI crew, a reviewer reading the file — exactly
like an agent with a real human behind it. It is strictly worse than an agent with no `ownerId` at
all, which at least reads as the open question it is. That is why `dangling-owner` blocks and
`unaccountable-agent` only warns.

`orphan-subscription` blocks for the same reason: a bounded context declaring a subscription is
declaring a contract. If nothing in the org publishes the other half, the integration is either
broken or depends on a publisher nobody has written down, and both are worth stopping for.

## Why the rest only warn

- **`unconsumed-event`** is often fine — an external consumer, or an event published ahead of the
  service that will read it. It is a smell, not a defect.
- **`vacant-load-bearing`** is a real accountability hole, but vacancies are also a normal, temporary
  state of any org. Failing a build because somebody resigned would make the check something teams
  route around.
- **`unacknowledged`** may just mean the other team has not written their side up yet.
- **`unscored-supervision`** is a prompt, not a defect: supervising agents is real work that no role
  describes and no sprint budgets for, and a cognitive-load assessment that omits it is describing
  a quieter team than the one doing the work. Only reported for teams that assess their load at all
  and run at least one active agent.

## Matching

**Events** match exactly, by name, across every `boundedContext` in the resolved graph — not
per-team. A publisher on any team satisfies a subscriber on any other; that is what makes this a
cross-boundary check rather than four independent ones.

**Only `collaboration` is expected to be mutual.** `x-as-a-service` is deliberately one-directional
in Team Topologies — a platform team publishes a service and consumers help themselves, so
expecting the platform to name every consumer back would be wrong — and `facilitating` is coaching,
which the enabling team drives. Collaboration is the high-bandwidth, two-way, explicitly time-boxed
mode both sides are supposed to have agreed to, so one team declaring it alone means the other side
is not budgeting for it.

Where two teams describe the same relationship with _different_ modes, that is already surfaced as
a `conflict` by `deriveContextMap`, so this check stays silent rather than reporting it twice.

**Vacancy** means no `members[]` entry lists the role in its `roleIds`. Only vacancies that another
team's resolved `reportsTo`/`reportsToRef` edge terminates in are reported — a vacancy inside one
team is that team's business.

## Deliberately not a validator

`teamapi validate` answers "is this document well-formed and do its references resolve". This
answers "does the org these documents describe have someone on both sides of every seam". Keeping
them apart means `validate` stays a hard gate on syntax while `gaps` can report judgement calls
without blocking anyone's build.

It is also pure: no network, no token, no filesystem beyond reading the documents themselves. The
whole check is a function of the resolved graph — which is why, unlike the drift checks, it is also
served as `GET /gaps` and the `get_org_gaps` MCP tool. An assistant asking "what is nobody
responsible for here?" can compute the answer itself rather than waiting for someone to paste a
CI log.

## Suggested loop

1. Run `teamapi gaps` in CI on every pull request that touches a `teamapi.yml`, as a required check.
   Only the two blocking kinds will fail it. The bundled action does this for you with
   `check-gaps: true` — see [CI integration](../../README.md#ci-integration).
2. Triage the warnings in the team's regular review — each one names a specific seam and the teams
   on either side of it.
3. When a warning is a deliberate choice (an event with only external consumers, say), record it as
   a `memory[]` entry on the owning team so the next person to read the report knows it was decided,
   not missed.
