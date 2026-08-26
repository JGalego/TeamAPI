# Prometheus

The [OpenTelemetry generator](opentelemetry.md) adds team ownership to service telemetry.
`--metrics` exports the org graph itself for charts and alerts.

```bash
teamapi serve-api /path/to/your/org --metrics
curl -s http://127.0.0.1:3000/metrics
```

Off by default. A `/metrics` endpoint is one more surface, and a server nobody scrapes should not
have one.

## What's exported

### The org

| metric                                   | labels             | what it says                                              |
| ---------------------------------------- | ------------------ | --------------------------------------------------------- |
| `teamapi_org_teams`                      | `type`             | Teams, by Team Topologies type.                           |
| `teamapi_org_teams_total`                |                    | Teams resolved.                                           |
| `teamapi_org_members_total`              |                    | Declared members. A person on two teams counts twice.     |
| `teamapi_org_roles_total`                |                    | Declared roles.                                           |
| `teamapi_org_vacant_roles_total`         |                    | Roles no member fills.                                    |
| `teamapi_org_services_total`             |                    | Declared services.                                        |
| `teamapi_org_agents`                     | `status`           | AI agents, by status. Adoption, without running a report. |
| `teamapi_org_edges`                      | `kind`             | Team-level edges: interaction, dependency, platform.      |
| `teamapi_org_role_edges`                 | `kind`             | Role-level edges: reports-to, advises, learns-from, …     |
| `teamapi_org_unresolved_refs_total`      |                    | References the resolver could not satisfy.                |
| `teamapi_org_resolved_timestamp_seconds` |                    | When the served graph was resolved.                       |
| `teamapi_cognitive_load`                 | `team`, `label`    | Per-team intrinsic + extraneous + germane.                |
| `teamapi_supervision_load`               | `team`             | Per-team agent-supervision load.                          |
| `teamapi_gaps`                           | `kind`, `severity` | Accountability gaps between teams.                        |
| `teamapi_policy_findings`                | `severity`         | Declared-policy findings.                                 |
| `teamapi_topology_findings`              | `kind`             | Team Topologies design smells.                            |

### The server

`teamapi_http_requests_total` and the `teamapi_http_request_duration_seconds_*` histogram, both
labelled `method` / `route` / `status`, plus `teamapi_build_info` carrying the version.

## Cardinality

Team ids appear as labels; nothing else unbounded does. Teams are bounded by the org and change on
the timescale of reorganizations, which is what a label is for. Member names, service names and
finding messages are deliberately absent — a series per person is both a cardinality problem and,
on a shared Prometheus, a directory of everybody's name.

The `route` label is the route _template_ (`/teams/:id`), never the URL that arrived, and a request
matching no route is labelled `__unmatched__`. Scanners produce unbounded 404 paths; without that,
each one would mint a series.

## Authentication

`/metrics` sits behind the same bearer token as everything else, unlike `/health`. It carries team
ids, team types and per-team load scores — less than `/graph` gives away, but not nothing, and a
scraper can send a header where a load balancer's liveness probe cannot.

```yaml
scrape_configs:
  - job_name: teamapi
    authorization:
      credentials_file: /etc/prometheus/teamapi-token
    static_configs:
      - targets: ["teamapi:3000"]
```

## Alerts worth having

```yaml
groups:
  - name: teamapi
    rules:
      # The served graph stopped being refreshed. This is the failure that looks like nothing:
      # the API keeps answering, correctly, about the org as it was a fortnight ago.
      - alert: TeamApiGraphStale
        expr: time() - teamapi_org_resolved_timestamp_seconds > 86400
        for: 1h

      # A reference stopped resolving, so the graph being served is incomplete — every gap and
      # ownership answer computed from it is now suspect.
      - alert: TeamApiUnresolvedRefs
        expr: teamapi_org_unresolved_refs_total > 0
        for: 15m

      # A team is drowning. Worth alerting on precisely because nobody files a ticket about it.
      - alert: TeamOverloaded
        expr: teamapi_cognitive_load > 21
        for: 7d

      # Agents grew, supervision didn't. The load exists whether or not anyone scored it.
      - alert: UnscoredSupervision
        expr: teamapi_supervision_load == 0 and on(team) teamapi_cognitive_load > 0
        for: 7d
```

The `for:` durations use days because these metrics describe the organization, not live service
health. None represents an incident. Paging about cognitive load at 3am would be useless and would
quickly get the alerts muted.
