# Port

[Port](https://www.getport.io/) is an internal developer portal built on blueprints and entities
rather than a fixed catalog model. TeamAPI already knows your teams, services and people; this
target hands them over.

```bash
teamapi generate port /path/to/your/org --out ./port
```

```text
port/blueprints.json    # apply once
port/entities.json      # apply on every change
```

Two files because they go to different endpoints and have different lifecycles: blueprints
define the shape and change rarely, entities are the data and change every merge.

## The model

| blueprint | from | properties | relations |
|---|---|---|---|
| `teamapi_team` | each team | topology, focus, **cognitive load + label** | `members` → person |
| `teamapi_service` | `services[]` | repository, versioning | `owner` → team |
| `teamapi_person` | `members[]` | email, GitHub username, allocation | — |

## Why this and not just Backstage

They overlap almost entirely, with one exception that matters: **cognitive load**.

Port scores and colours numeric properties, so a team's self-assessed load becomes something you
can sort a table by, set a threshold on, and alert from. Backstage's entity model has nowhere to
put it, so the [Backstage target](../../README.md#backstage-catalog) drops it — the single most
actionable number in a Team API document goes nowhere.

If you run Backstage, keep using that target. If you're choosing, this one carries more of the
spec.

## Deliberate limits

- **No role blueprint.** Team API models roles independently of the people filling them; Port
  models entities and relations. A role with nobody in it has no natural Port shape, and inventing
  one means a blueprint that is empty in most orgs.
- **A person appears once**, related to every team that lists them, since Port identifiers are
  global.
- **Team-to-team `interactions[]` and `dependencies[]` aren't emitted.** They'd need a fourth
  blueprint whose semantics differ from what Port users expect of a relation, and the
  [context map](../../README.md#diagrams) renders them better than a portal table would.

## Suggested loop

1. `teamapi generate port --out ./port` on merge.
2. `POST port/blueprints.json` once, then upsert `entities.json` through Port's bulk entity API.
3. Build a scorecard on `cognitiveLoad` — it's the field nothing else in the toolchain surfaces
   quite so directly.
