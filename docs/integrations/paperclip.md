# Paperclip

[Paperclip](https://github.com/paperclipai/paperclip) is an AI agent orchestration platform — a
task manager, an org chart for agents, a skills studio, and a multi-provider runtime with
sandboxing and cost controls.

It overlaps with TeamAPI in one specific place: both model an organisation. That overlap is the
opportunity and also the hazard, so the division of labour matters more than the wiring.

## The division of labour

**TeamAPI declares. Paperclip enforces and executes.**

TeamAPI's `AgentSchema.permissions` field is documented as *"enforced by whatever external
automation actually executes the agent's actions, not by this schema."* Paperclip is that
automation — it has a governed tool gateway, budgets, and approval workflows. TeamAPI has the
reviewed, versioned statement of what *should* be true.

So the flow runs one way: **spec → runtime**, the way Terraform config relates to infrastructure.
Two org charts with two write paths is a classic failure mode; this integration designates
TeamAPI's as authoritative because it's the one with a diff and a reviewer, and treats Paperclip's
as derived.

Nothing here writes back into `teamapi.yml`. If you want runtime facts to inform the spec — say,
observed agent load feeding `cognitiveLoad` — the right shape is a scheduled job that opens a
**pull request**, so the change is reviewed like any other org change.

## 1. Give every agent the org graph, through MCP

Paperclip's tool gateway speaks MCP over local stdio. TeamAPI ships an MCP server, so this is
configuration rather than code, and it is the highest-value step.

```bash
teamapi serve-mcp /path/to/your/org
```

Register that command as a local stdio MCP tool provider in Paperclip. Every agent then gets the
org graph as governed tools:

| Tool | What an agent can finally answer |
|---|---|
| `find_service_owner` | "Who owns `checkout-api`?" — instead of guessing or asking in Slack |
| `get_team_cognitive_load` | "Is this team already overloaded?" before assigning more work |
| `get_team_dependencies`, `get_team_interactions` | "Who do I need to coordinate with?" |
| `get_context_bundle` | Everything relevant to a stated goal, in one call |
| `list_policies`, `list_steering_documents` | The standards this team actually holds |

`get_context_bundle` is worth calling out. Given a goal — `{"goal": "Implement OAuth"}`, optionally
scoped to a team — it returns the relevant specifications, steering documents, policies, memory and
knowledge base entries, ranked by keyword overlap with the matched terms attached. It's designed to
be the one call an assistant makes to get oriented, which is exactly what an agent picking up a
Paperclip ticket needs. **This is why there is no separate Paperclip plugin in this integration:**
the context-bundle use case is already served by a tool the MCP gateway can reach, and Paperclip's
external plugin contract is still in flight. Registering the MCP server delivers it without
building against a moving target.

## 2. Export the org as an Agent Companies package

```bash
teamapi generate paperclip /path/to/your/org --out ./company --company "ACME Org"
```

This emits an [`agentcompanies/v1`](https://github.com/paperclipai/paperclip/blob/main/docs/companies/companies-spec.md)
package — markdown with YAML frontmatter, filesystem- and git-native. The spec is explicitly
vendor-neutral, so the output is useful to any agent-company runtime, not only Paperclip.

```text
COMPANY.md
teams/<team-id>/TEAM.md
agents/<team-id>-<agent-id>/AGENTS.md
skills/<team-id>-<prompt-id>/SKILL.md
```

| TeamAPI | Package |
|---|---|
| the org graph | `COMPANY.md`, including every team |
| a team + its `info.type` | `TEAM.md`, topology type as a tag |
| `agents[]` | `AGENTS.md`, one per active agent |
| `prompts[]` | `SKILL.md`, a valid Agent Skills package |
| `policies[]` | rendered into the team body, where markdown is canonical |
| `provider`, `model`, `ownerId`, `permissions` | `metadata.teamapi` |

Three deliberate gaps, each because the source data doesn't support the alternative:

- **No `reportsTo` on agents.** TeamAPI models reporting between *roles* — people — not between
  agents. Any agent hierarchy here would be invented, so the runtime arranges them.
- **No per-agent `skills`.** Prompts become real skill packages, but nothing in the schema says
  which agent uses which, so they attach at team level rather than being guessed.
- **Non-active agents are skipped.** Exporting a `deprecated` agent into a runtime that provisions
  from the package would bring it back to life. Skipped ids are printed.

Ids are prefixed with their team (`platform-payments-docs-writer`) because TeamAPI ids are unique
within a team while the package flattens agents and skills into root-level directories.

## 3. Detect drift

Paperclip's org is editable from its UI; the spec is only editable through review. Drift is
therefore guaranteed, not hypothetical.

```bash
export PAPERCLIP_API_KEY=...
teamapi paperclip-drift /path/to/your/org --url http://localhost:3000 --company <company-id>
```

Read-only in both directions. It reports:

- **undeclared** — running in Paperclip, declared nowhere
- **missing** — declared and active, nothing running
- **forbidden** — running for a team whose policies deny agents

Only `forbidden` exits non-zero, so this can gate a required check without ordinary drift failing
CI. In `examples/acme-org` that's a real case rather than a hypothetical: `stream-onboarding` is
the only team touching raw KYC data, carries `policies/no-agents-on-applicant-pii`, and declares no
`agents[]`. An agent appearing there is a governance breach, and this command fails the build.

```text
! forbidden: 'KycHelper' runs for stream-onboarding, whose policy 'no-agents-on-applicant-pii' forbids agents
+ undeclared: 'ShadowAgent' is running in Paperclip but no teamapi.yml declares it
- missing: platform-payments/docs-writer is declared and active but nothing is running for it

3 finding(s), 1 blocking; 3 agent(s) matched.
```

Agents are attributed back to a team through the `metadata.teamapi` block the generator writes,
falling back to the scoped slug so agents created by hand in Paperclip's UI still match.

## Suggested loop

1. Author teams, agents, and policies in `teamapi.yml`; review changes as pull requests.
2. `teamapi generate paperclip` on merge; import the package into Paperclip.
3. Register `teamapi serve-mcp` with the tool gateway so agents can query the org they belong to.
4. Run `teamapi paperclip-drift` on a schedule, and fail the build on a blocking finding.
