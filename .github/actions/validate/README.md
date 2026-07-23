# Team API Validate & Preview

A composite GitHub Action: runs `teamapi validate` on your Team API as Code documents and, on a
pull request, posts (and keeps updated on later pushes) a comment with the result — plus a
rendered Mermaid diagram preview when validation passes.

## Usage

```yaml
name: Team API

on:
  pull_request:
    paths:
      - "org/**/teamapi.yml" # adjust to wherever your teamapi.yml files live

permissions:
  pull-requests: write # needed to post the PR comment

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: JGalego/TeamAPI/.github/actions/validate@main
        with:
          patterns: org # file paths, globs, or a directory — same as the CLI
          render-scope: topology # topology | hierarchy | context-map | org-hierarchy
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `patterns` | `.` | File paths, globs, or a directory to auto-discover `teamapi.yml` under — passed straight through to `teamapi validate`/`teamapi render`. |
| `render-scope` | `topology` | Diagram scope to preview: `topology` \| `hierarchy` \| `context-map` \| `org-hierarchy`. |
| `render-team` | *(none)* | Team id to scope the preview to — required if `render-scope: hierarchy`. |
| `comment` | `true` | Post (and keep updated) a PR comment with the result. Set `false` to only validate. |
| `github-token` | `${{ github.token }}` | Token used to read/post the PR comment. |

## Outputs

| Output | Description |
|---|---|
| `success` | `'true'` if validation passed, `'false'` otherwise. |
| `diagram` | The rendered Mermaid diagram text (empty if validation failed). |

## Behavior

- The job **fails** (non-zero exit) if `teamapi validate` reports any unresolved reference, so this can gate a required check.
- The PR comment is idempotent: pushing more commits to the same PR updates the existing comment (matched via an HTML marker) instead of piling up new ones.
- On validation failure, the comment shows the `teamapi validate` output only — no diagram preview is rendered, since the graph is by definition incomplete.

See [`action.yml`](action.yml) for the full implementation.
