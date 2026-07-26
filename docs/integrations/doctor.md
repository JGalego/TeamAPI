# `teamapi doctor`

Every network integration here degrades **silently** rather than loudly.

A rejected Slack token reads as an empty workspace, so every declared channel comes back
`missing`. An Okta client that stops at page one makes everyone past the first batch look like a
leaver — and that's a *blocking* finding, about people who never left. A PagerDuty key that can
see services but not escalation policies reports every service as paging nobody, and fails the
build for all of them.

Those are wrong answers, delivered confidently, and nothing downstream can tell the difference.
So the first question anyone has when a drift report surprises them — *is my token even right?* —
gets its own command.

```bash
teamapi doctor slack --token xoxb-…
teamapi doctor pagerduty                    # reads PAGERDUTY_TOKEN
teamapi doctor okta --url https://acme.okta.com
teamapi doctor github --org acme
```

```text
slack
  ✓ authenticate   workspace Acme as teamapi
  ✓ list channels  4 channel(s) visible
  ✓ channel shape  every channel has an id and a name
  ✓ pagination     followed to 4 item(s) at one per page

All checks passed.
```

Exit code is 1 if any check fails, so this works as a preflight step in CI.

## The checks

| check | what it rules out |
|---|---|
| `authenticate` | a rejected token being read as an empty account |
| the read | scopes that allow auth but not the list call |
| shape | the fields the drift checks depend on being absent |
| `pagination` | stopping at page one, which invents findings about everything after it |

Provider-specific shape checks earn their place by naming the consequence:

- **PagerDuty** — if no service resolves an escalation policy, every responder count is zero and
  the blocking finding fires for everything.
- **Okta** — if no group has a member with an address, every declared member reads as a leaver.

## How the pagination check works

It asks for **one item per page** and counts what comes back. Getting more than one item can only
happen if the next page was actually fetched — no request counting, no mocking, no need for an
account with two hundred channels in it.

With one item or none, it reports `skip`, not `pass`. A check that couldn't run shouldn't look
like one that did.

## Safety

Read-only against every provider. It lists; it never writes. A failed prerequisite marks the
checks after it as `not run` rather than letting them fail for the wrong reason.

## Not covered

**Paperclip.** Its HTTP is still inline in `paperclip-drift` rather than in a client, so there's
nothing for `doctor` to probe yet. Extracting it is the obvious next step.
