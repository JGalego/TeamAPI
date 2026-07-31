# OpenTelemetry

A trace arrives with a service name and nothing else. Working out which team to wake up means
someone opening a wiki — at exactly the moment nobody has time to.

```bash
teamapi generate otel /path/to/your/org --out ./otel
```

```text
otel/checkout-api.env
otel/ledger.env
otel/onboarding-api.env
otel/payments-api.env
otel/collector.yaml
```

## The attributes

| attribute            | from                                                      |
| -------------------- | --------------------------------------------------------- |
| `service.name`       | the service                                               |
| `service.namespace`  | the owning team's id                                      |
| `teamapi.team`       | team id                                                   |
| `teamapi.team_name`  | the team's display name                                   |
| `teamapi.topology`   | stream-aligned, platform, complicated-subsystem, enabling |
| `teamapi.channel`    | the team's Slack channel — where an alert should go       |
| `teamapi.repository` | the service's repository                                  |

`service.name` and `service.namespace` are the semantic-convention names. Everything else sits
under a `teamapi.` prefix on purpose: OpenTelemetry has no standard attribute for _which team owns
this_, and squatting in the reserved namespace is how you collide with a future spec revision.

## Two ways to apply it, because two different people own the levers

**Per service** — `checkout-api.env` holds one line an SDK reads directly:

```bash
OTEL_RESOURCE_ATTRIBUTES=service.name=checkout-api,service.namespace=stream-checkout,teamapi.team=stream-checkout,teamapi.team_name=Stream%20Checkout,…
```

Needs every service's deployment touched, but works with no collector changes.

**Centrally** — `collector.yaml` is a `transform` processor that stamps the same attributes based
on `service.name`:

```yaml
processors:
  transform/teamapi:
    error_mode: ignore
    trace_statements:
      - context: resource
        statements:
          - set(attributes["service.namespace"], "stream-checkout") where attributes["service.name"] == "checkout-api"
```

One config, no deployments touched — if you're the one who owns the collector.

## Two details that matter

**Values are percent-encoded.** `OTEL_RESOURCE_ATTRIBUTES` is W3C Baggage: comma-separated
`key=value`. A team name or focus containing a comma would silently truncate the list, dropping
every attribute after it. Encoding is not cosmetic here — it's the difference between working and
appearing to work.

**One OTTL statement per attribute.** The grammar is a single editor with an optional `where`, so
`set(...) set(...)` on one line does not parse. The generated config is longer than it looks like
it needs to be for exactly that reason.

## Suggested loop

1. `teamapi generate otel` on merge.
2. Apply the collector config, or roll the env files into your deployment templates.
3. Facet dashboards and alert routing on `teamapi.team`, and send the page to `teamapi.channel`.
