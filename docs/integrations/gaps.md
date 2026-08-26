# Gaps

Most checks compare the spec with an outside system such as a directory, pager, or running agent
fleet. `teamapi gaps` finds holes that appear only after the documents are resolved into one graph.

Each team document can be valid on its own while the combined graph is incomplete. A subscriber
looks complete until the graph shows that nobody publishes its event. A vacant seat becomes
load-bearing only when two other teams report into it. These gaps sit between teams and have no
obvious owner.

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

**Two findings exit non-zero:** `orphan-subscription` and `dangling-owner`. Both declarations look
complete while pointing to something that does not exist. [`okta.md`](okta.md) treats deactivated
accounts the same way because a stale name still appears authoritative.

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

## Separate from validation

`teamapi validate` checks document structure and reference resolution. `teamapi gaps` checks
whether the resolved org has someone on both sides of each seam. Keeping the commands separate
lets validation remain a hard syntax gate while most gap findings remain non-blocking judgement
calls.

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
