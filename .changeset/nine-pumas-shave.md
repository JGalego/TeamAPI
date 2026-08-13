---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add `--format json` and `--format sarif` to the reporting commands.

`validate`, `gaps`, `policy` and `shadow-ai` now take `--format text | json | sarif`, and `diff`
takes `--format text | json`. Everything printed human-readable text before, so a CI job could
gate on an exit code but never say _what_ was wrong on the diff that caused it.

The SARIF output is the point: uploaded with `github/codeql-action/upload-sarif` (the bundled
action gains a `sarif-dir` input that writes it), every finding becomes an inline annotation on
the pull request and an entry in the security tab. Paths are emitted relative to the working
directory, since consumers resolve them against the repository root.

`json` emits the report object the library returns rather than a re-rendering of the text, and the
unresolved-reference warning is suppressed for structured formats so the output stays parseable.
Exit codes are unchanged by the format.
