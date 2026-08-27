# Evaluate TeamAPI on an existing organization

This guide produces a useful baseline without asking an organization to redesign itself first. Start with a bounded
set of teams or repositories, preserve what the source systems actually say, and use the first report to decide what
is worth modelling more deeply.

## What the evaluation answers

By the end, you should be able to answer:

- Which services, event contracts and AI agents lack accountable owners?
- Which declared policies are violated, delegated or enforced by nothing?
- Which team interactions show expensive or inverted topology?
- Which repository AI artifacts disagree with the declared agent inventory?
- Can a developer or assistant reliably find the owner of a service?

The assessment reports evidence in the supplied files and repository checkouts. A clean result is not proof that no
undocumented work or AI usage exists elsewhere.

## 1. Choose a representative scope

Use 5–20 repositories owned by two or three teams. Include a platform team and at least one team consuming it. Avoid
starting with the whole company: a smaller scope reaches the first actionable finding faster and makes source-system
conflicts easier to understand.

## 2. Import what already exists

Use the strongest available source. Imports deliberately leave fields empty rather than inventing organizational
facts.

```bash
# GitHub teams and membership
teamapi import github-org acme --out teams

# A processed Backstage catalog
teamapi import backstage https://backstage.example/api/catalog/entities --out teams

# A directory or roster
teamapi import okta https://acme.okta.com --out teams
teamapi import csv roster.csv --out teams
```

Review the generated documents, then create a project configuration so later commands need no paths:

```yaml
patterns:
  - teams
```

```bash
teamapi fmt teams
teamapi validate
```

## 3. Establish the baseline

`assess` resolves the graph once and combines accountability gaps, policy checks and Team Topologies heuristics. Add
`--scan` when a directory contains one checkout per repository; shadow-AI findings are omitted when it is absent.

```bash
teamapi assess --state .teamapi/assessment.json
teamapi assess --scan repositories --state .teamapi/assessment.json
```

The command exits non-zero only when at least one finding is `blocking`. Warnings remain visible without making an
evaluation impossible to adopt.

The state file is replaced only after a successful assessment. On later runs, the report names stable finding IDs
that appeared or disappeared since the previous baseline.

## 4. Produce artifacts for people and automation

```bash
# Self-contained report for a browser or CI artifact
teamapi assess --format html --out teamapi-assessment.html

# Structured data for scripts
teamapi assess --format json --out teamapi-assessment.json

# GitHub code scanning and other SARIF consumers
teamapi assess --format sarif --out teamapi-assessment.sarif
```

The JSON report contains `summary`, `findings`, `comparison`, `snapshot`, `scans` and the next `state`. Every finding
has a deterministic `id`, source check, stable `ruleId`, severity, target and detail.

## 5. Inspect one finding end to end

Choose one finding that the affected team agrees is real:

1. Follow its `targetId` and `teamId` to the source document.
2. Confirm the source system or repository evidence.
3. Fix the declaration or the underlying ownership problem.
4. Run the assessment again.
5. Confirm its stable ID appears under `resolvedFindingIds`.

If the finding is understood but intentionally accepted, use a narrow, expiring gap waiver rather than disabling an
entire class of checks. Record the reason so a future reviewer can decide whether the exception still applies.

## 6. Query the result

Serve the same graph through the dashboard, REST API and MCP:

```bash
teamapi serve-api --port 3000
teamapi serve-mcp
```

Check three representative questions:

- Who owns a selected service?
- Which team interaction explains a dependency?
- Which human is accountable for an active agent?

An evaluation succeeds when the answer is both correct and easier to obtain than asking around—not when every
optional field has been populated.

## 7. Automate only after review

Once the baseline is credible, add assessment to pull requests or a schedule. Pin the TeamAPI version in automation,
retain the state file in a cache or artifact, and upload SARIF when repository permissions allow it.

Keep generated Team API documents in git. Changes remain reviewable, attributable and reversible; an import or
assessment should never mutate an external system.

## Evaluation checklist

- [ ] Representative teams and repositories selected
- [ ] Imported documents reviewed rather than accepted blindly
- [ ] `teamapi validate` passes
- [ ] Baseline state retained
- [ ] HTML or JSON assessment archived
- [ ] At least one finding confirmed with its owning team
- [ ] At least one finding fixed or explicitly waived
- [ ] Ownership queries verified through REST or MCP
- [ ] Automation pinned to a known TeamAPI version
