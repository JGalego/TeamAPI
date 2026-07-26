# Slack

Every other surface in this toolchain assumes someone already decided to go and look something
up. Slack is where the question actually gets asked, usually as "does anyone know who owns
checkout-api?" into a channel of 200 people.

There are two halves: answer the question where it's asked, and make each channel say who it
belongs to.

## 1. `/whoowns` in Slack

The REST API serves a slash-command endpoint at `POST /slack/whoowns`, backed by the same
`findServiceOwner` lookup the API and the MCP server use.

```bash
export SLACK_SIGNING_SECRET=...      # from your Slack app's Basic Information page
teamapi serve-api /path/to/your/org
```

Point a slash command at `https://<your-host>/slack/whoowns`, and:

```text
/whoowns checkout-api

  `checkout-api` is owned by *Stream Checkout* (`stream-checkout`).
  _Shopping cart, checkout flow, and order placement_
  Ask in #stream-checkout.
```

Unknown service names get the list of what *is* declared, which is usually enough to spot the
name someone half-remembered.

**The route only exists when `SLACK_SIGNING_SECRET` is set.** Not "returns 401 when unset" —
it isn't registered at all, so a misconfigured deployment can't expose an unauthenticated
endpoint. Requests are checked against Slack's `v0:<timestamp>:<body>` HMAC in constant time, and
anything more than five minutes old is rejected so a captured request can't be replayed.

## 2. Channel topics that say who owns the channel

```bash
export SLACK_BOT_TOKEN=xoxb-...
teamapi slack-sync /path/to/your/org            # prints the plan
teamapi slack-sync /path/to/your/org --yes      # applies it
```

Same plan/apply split as [`teamapi apply`](../../README.md#apply) — it writes to a system outside
the repo, so it shows you first:

```text
~ #stream-checkout (stream-checkout)
    - (no topic)
    + Stream Checkout — Shopping cart, checkout flow, and order placement · Owns: checkout-api
  #enabling-devex: up to date
  #platform-payments: declared by platform-payments, no such channel in Slack
! #shared-ops is claimed by platform-payments and stream-checkout — left alone
  3 channel(s) no team declares, left alone

1 topic(s) to update.
```

Requires `channels:read` and `channels:manage` (plus the `groups:` equivalents for private
channels).

## What it deliberately doesn't do

- **Only topics.** Not channel creation, not invites, not archiving. A channel is a social object
  with history in it, and a spec file is the wrong thing to be quietly reorganising one.
- **Channels nobody declares are left alone**, and counted in the output. Not every channel
  belongs to a team, and treating undeclared as unowned would be wrong.
- **A channel claimed by two teams gets no topic.** Same call as
  [CODEOWNERS](codeowners.md), for the same reason: the answer is a decision someone has to make,
  not a default the tool should pick.
- **Nothing writes back to `teamapi.yml`.** If Slack is where a channel is really created, add it
  to the team document in a pull request.

## Suggested loop

1. Declare each team's channel in `channels[]` with `type: slack`.
2. Run `teamapi slack-sync` on merge so topics track the spec.
3. Serve the REST API with `SLACK_SIGNING_SECRET` set and register the `/whoowns` command.
4. When someone asks in a channel anyway, the answer is one slash command away.
