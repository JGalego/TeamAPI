---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add a `generate otel` target: ownership as OpenTelemetry resource attributes, so
traces, metrics and alerts attribute themselves to a team. Emits one `.env` per
service holding an `OTEL_RESOURCE_ATTRIBUTES` line, and a collector `transform`
processor that stamps the same attributes centrally. Values are percent-encoded,
since the variable is W3C Baggage and a comma in a team name would otherwise
truncate the list.
