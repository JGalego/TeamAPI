# PagerDuty

Ownership without escalation is half an answer. "Who owns `checkout-api`" at three in the morning
doesn't mean the org chart — it means the rotation.

Those two drift apart quietly, because PagerDuty gets edited _during_ an incident and
`teamapi.yml` gets edited in review. Nobody notices until the next one.

```bash
export PAGERDUTY_TOKEN=...
teamapi pagerduty-drift /path/to/your/org
```

## What it reports

```text
! unresponsive: 'checkout-api' escalates to 'stream-checkout on-call', which has nobody on it
- unmonitored: 'ledger' is declared by platform-payments but has no PagerDuty service
+ undeclared: 'legacy-batch' is in PagerDuty but no teamapi.yml declares it
~ misattributed: 'payments-api' escalates to 'Default Escalation Policy', which doesn't name platform-payments

4 finding(s), 1 blocking; 2 service(s) matched.
```

| finding         | meaning                                                              | blocking |
| --------------- | -------------------------------------------------------------------- | -------- |
| `unresponsive`  | declared service with no escalation policy, or one with nobody on it | **yes**  |
| `unmonitored`   | declared service PagerDuty has never heard of                        | no       |
| `undeclared`    | PagerDuty service no team claims                                     | no       |
| `misattributed` | the policy doesn't name the team that declares the service           | no       |

**Only `unresponsive` exits non-zero**, so this can gate a required check without ordinary drift
failing the build. It earns that because a monitored service that pages nobody is worse than an
unmonitored one: the alert fires, the dashboard goes green-ish, and everyone assumes it was
handled.

`unmonitored` deliberately isn't blocking — plenty of declared services are libraries or internal
tools nobody should be woken for, and forcing a PagerDuty entry for each would teach people to
stop declaring services.

## Matching

PagerDuty service names are typed by hand, so matching is loose: case, spaces, underscores and
hyphens all collapse. `Checkout API`, `checkout_api` and `checkout-api` are the same service.

Attribution works the same way — a policy counts as the team's if its name contains the team id
or the team's display name, so `Stream Checkout on-call` and `stream-checkout-oncall` both match.
That's a convention rather than a contract, which is why a mismatch is only a warning.

## Read-only, deliberately

Nothing here writes to PagerDuty, and nothing writes back to `teamapi.yml`. PagerDuty
configuration is usually owned by Terraform, and a second write path into it would be exactly the
failure mode the [Paperclip integration](paperclip.md) is careful to avoid. There is no
`generate pagerduty` target for the same reason: emitting escalation policies TeamAPI can't
resolve to real user ids would produce plausible, wrong config.

What the schema _can_ support later is user matching — `members[].contact` holds an email, and
PagerDuty users are keyed by email — so `unresponsive` could grow from "nobody is on this policy"
to "nobody on this policy is on this team". That needs the policy's targets expanded, which the
current query doesn't fetch.

## Suggested loop

1. Declare `services[]` on the team that owns each one.
2. Run `teamapi pagerduty-drift` on a schedule, and as a required check.
3. Let `unresponsive` fail the build. Everything else is a report to read on a Monday.
