# Okta

Okta is authoritative for who has joined, moved, or left, regardless of whether anyone updated a
team document. `okta-drift` finds changes in the directory that the documents have not caught up
with.

```bash
export OKTA_TOKEN=...
teamapi okta-drift /path/to/your/org --url https://acme.okta.com
```

## What it reports

```text
! deactivated: 'yuki-tanaka' <yuki.tanaka@acme.example> is DEPROVISIONED in the directory but still listed on stream-checkout
- left: 'noah-fischer' <noah.fischer@acme.example> is declared on stream-onboarding but not in its directory group
+ joined: New Joiner is in stream-checkout's directory group but no member declares them
? no-group: no directory group matches 'enabling-devex'

4 finding(s), 1 blocking; 6 member(s) matched.
```

| finding       | meaning                                           | blocking |
| ------------- | ------------------------------------------------- | -------- |
| `deactivated` | declared member whose account is no longer active | **yes**  |
| `left`        | declared member who isn't in the group            | no       |
| `joined`      | active group member nobody declares               | no       |
| `no-group`    | team with no matching directory group             | no       |
| `unmatched`   | member with no `contact` address to match on      | no       |

**Only `deactivated` exits non-zero.** A missing name is ordinary drift; a deactivated account
still listed as accountable is actively misleading. CODEOWNERS, the dashboard, and an agent
answering "who owns this" all continue to treat that person as an owner.

`joined` and `left` are ordinary lag and shouldn't fail a build; they're a pull request waiting to
be written.

## Matching

Teams match groups **by name**, so an Okta group called `stream-checkout` reconciles the team with
that id. Directories rarely name groups that cleanly, so `--group-prefix eng-` strips a prefix
first — `eng-stream-checkout` matches `stream-checkout`.

People match **by email**, from `members[].contact`, case-insensitively and ignoring surrounding
whitespace. A member with no `contact` is reported as `unmatched` rather than assumed present or
absent — a guess either way would be worse than saying so.

An inactive account that nobody declares is _not_ reported as a joiner. It's an old account, not a
new colleague.

## Why it is read-only

Nothing is written back to `teamapi.yml`. Letting a reconciler edit it would create a second write
path to the project's source of truth, violating the same rule used by the
[Paperclip integration](paperclip.md). A scheduled job can automate updates by opening a **pull
request**, keeping each joiner subject to normal review.

## Suggested loop

1. Give each team a directory group named after its id, or use `--group-prefix`.
2. Run `teamapi okta-drift` on a schedule, and as a required check.
3. Let `deactivated` fail the build. Turn `joined` and `left` into a pull request.
