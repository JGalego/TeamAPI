# PagerDuty

At three in the morning, "Who owns `checkout-api`?" means the on-call rotation as much as the org
chart.

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

**Only `unresponsive` exits non-zero**, allowing it to gate a required check while ordinary drift
remains informational. A monitored service that pages nobody is more dangerous than an
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
The match relies on a naming convention, so a mismatch is only a warning.

## Why it is read-only

Nothing here writes to PagerDuty or back to `teamapi.yml`. PagerDuty configuration is usually
owned by Terraform, and a second write path would create the same conflict described in the
[Paperclip integration](paperclip.md). There is no `generate pagerduty` target because TeamAPI
cannot resolve escalation policies to real user ids; the generated config would look plausible
while being wrong.

What the schema _can_ support later is user matching — `members[].contact` holds an email, and
PagerDuty users are keyed by email — so `unresponsive` could grow from "nobody is on this policy"
to "nobody on this policy is on this team". That needs the policy's targets expanded, which the
current query doesn't fetch.

## Suggested loop

1. Declare `services[]` on the team that owns each one.
2. Run `teamapi pagerduty-drift` on a schedule, and as a required check.
3. Let `unresponsive` fail the build. Everything else is a report to read on a Monday.
