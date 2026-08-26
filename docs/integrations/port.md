# Port

[Port](https://www.getport.io/) is an internal developer portal whose catalog is defined through
blueprints and entities. This target exports the teams, services, and people already recorded in
TeamAPI.

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

| blueprint         | from         | properties                                  | relations          |
| ----------------- | ------------ | ------------------------------------------- | ------------------ |
| `teamapi_team`    | each team    | topology, focus, **cognitive load + label** | `members` → person |
| `teamapi_service` | `services[]` | repository, versioning                      | `owner` → team     |
| `teamapi_person`  | `members[]`  | email, GitHub username, allocation          | —                  |

## Compared with Backstage

The two targets mostly overlap. Port also carries **cognitive load**.

Port scores and colours numeric properties, so a team's self-assessed load can drive table sorts,
thresholds, and alerts. Backstage's entity model has nowhere to put it, so the
[Backstage target](../../README.md#backstage-catalog) omits that number.

Existing Backstage installations can keep using that target. Port carries more of the TeamAPI
spec when either portal is an option.

## Limits

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
3. Build a scorecard on `cognitiveLoad`, which Port exposes directly as a numeric property.
