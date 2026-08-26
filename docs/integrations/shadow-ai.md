# Shadow AI

[`paperclip-drift`](paperclip.md) finds undeclared agents in one runtime behind one gateway. Most
shadow AI appears earlier: a `.mcp.json` committed during a delivery crunch, an SDK added to a
manifest, or a workflow step that calls a model. These changes can spread without going through
the approval process intended for them.

All of those artifacts are checked into git. TeamAPI can inspect that operating layer without a
gateway, runtime, or token.

```bash
teamapi shadow-ai examples/acme-org --scan ~/src
```

`--scan` takes a directory whose immediate subdirectories are repository checkouts. Nothing is
cloned or fetched; this reads what is already on disk.

## What it reports

```text
+ undeclared: 'checkout-api' carries AI artifacts (CLAUDE.md, package.json (openai)) but stream-checkout declares no agents[]
? unowned: 'legacy-batch' carries AI artifacts (.github/workflows/ai.yml (anthropics/claude-code-action@v1)) but no team declares the repository
! forbidden: 'onboarding-api' carries AI artifacts (.mcp.json) but stream-onboarding's policy 'no-agents-on-applicant-pii' forbids agents

3 finding(s), 1 blocking; 1 repo(s) matched, 1 quiet.
```

| finding           | meaning                                                                    | blocking |
| ----------------- | -------------------------------------------------------------------------- | -------- |
| `forbidden`       | AI artifacts in a repo owned by a team whose policies forbid agents        | **yes**  |
| `undeclared`      | AI artifacts in a repo whose owning team declares no `agents[]`            | no       |
| `unowned`         | AI artifacts in a scanned directory no team declares                       | no       |
| `declared-unseen` | a team declares active agents, but its scanned repos carry no trace of one | no       |

**Only `forbidden` exits non-zero.** Undeclared AI usage often means the document has not caught up
with an adoption. A policy breach means a team reviewed and recorded a ban on agents touching the
code, yet an agent artifact is present. Updating the spec is not an acceptable fix for that case.

`declared-unseen` runs the check in reverse, and only for teams whose repos were actually part of
the scan. A team that declares five agents and shows no trace of them has a document describing an
org that has moved on — the same rot `okta-drift` finds in `members[]`, one layer up.

## What it detects

| artifact             | recognised by                                                |
| -------------------- | ------------------------------------------------------------ |
| `mcp-config`         | `.mcp.json`                                                  |
| `agent-instructions` | `AGENTS.md`, `CLAUDE.md`                                     |
| `assistant-config`   | `.claude/`, `.cursor/`, `.cursorrules`, `.github/chatmodes/` |
| `llm-dependency`     | a known LLM SDK in `package.json` or `requirements.txt`      |
| `ai-workflow`        | a workflow `uses:` step naming a model vendor                |

Manifests are matched by package name rather than by import, because a manifest is the one place a
dependency is declared once instead of scattered across call sites. Workflow matching is loose on
purpose — an action reference naming a vendor is the signal, and pinning an exact allow-list of
action names would go stale faster than the check is worth.

## Matching

Directory basename against the last segment of a declared `services[].repository`, minus any
`.git`, case-insensitively — the same loose matching [`pagerduty-drift`](pagerduty.md) uses for
service names, and for the same reason. Being strict would only manufacture `unowned` findings for
repositories that are plainly declared.

## What it can't tell you

**The report covers declarations visible in repositories.** It cannot detect a team pasting into a
chat window all day. The result gives a lower bound on adoption, and a clean report does not prove
that nobody is using AI.

That is why the summary counts `quiet` repos separately, and why the no-findings sentence names
that number: a scan pointed at an empty tree would otherwise read exactly like a clean bill of
health.

It is also why the check is deliberately **local-only**. Reading a file listing from a provider API
would need a token and would still only see declarations — the same floor, at the cost of a network
dependency and a credential.

## Suggested loop

1. Run it wherever your repositories are already checked out — a CI job with a workspace, or a
   developer machine. Only `forbidden` will fail a build.
2. Take each `undeclared` finding to the owning team and either add the `agents[]` entry in a pull
   request, or remove the artifact. Both are fine answers; leaving it unanswered is not.
3. Treat `unowned` as a `services[]` gap first — usually the repository is real and simply
   undeclared, which [`teamapi gaps`](gaps.md) will also have opinions about.
