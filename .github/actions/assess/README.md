# TeamAPI assessment action

Runs `teamapi assess` over an organization's documents and optionally checked-out repositories. The action writes one
SARIF report and fails after upload when the assessment contains blocking findings.

```yaml
name: TeamAPI assessment

on:
  pull_request:
  schedule:
    - cron: "0 7 * * 1-5"

permissions:
  contents: read
  security-events: write

jobs:
  assess:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: JGalego/TeamAPI/.github/actions/assess@main
        with:
          patterns: teams
          teamapi-version: 0.7.0
          upload-sarif: "true"
```

Use `scan-dir` only after checking repository directories out beneath one parent. The action does not clone arbitrary
repositories or broaden the workflow token's permissions.

For baseline comparison, pass `state` and restore/save that file with `actions/cache` or an artifact. Do not preserve
the SARIF report as state: it is an output for code scanning, while the assessment state contains only graph metrics
and stable finding IDs.

Pin the action ref to a full commit SHA and `teamapi-version` to an npm version in production. The repository's
Changesets release tags are package-specific, so they are not stable generic action refs. Pinning both values keeps
automation from acquiring a new action implementation, CLI or finding rule without review.
