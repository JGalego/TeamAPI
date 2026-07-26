# Okta

Every other check in this toolchain compares the spec to a system the spec is supposed to drive.
This one compares it to the only system that is authoritative *over* it.

People join, move and leave whether or not anyone opens a pull request. A team document starts
rotting the day it's written, and nothing else here can tell.

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

| finding | meaning | blocking |
|---|---|---|
| `deactivated` | declared member whose account is no longer active | **yes** |
| `left` | declared member who isn't in the group | no |
| `joined` | active group member nobody declares | no |
| `no-group` | team with no matching directory group | no |
| `unmatched` | member with no `contact` address to match on | no |

**Only `deactivated` exits non-zero.** The dangerous finding isn't the missing name — it's the one
that's *still there*. A deactivated account listed as accountable for a service reads, to
everything downstream (CODEOWNERS, the dashboard, an agent answering "who owns this"), as an
owner. Someone who left three months ago is silently on the hook.

`joined` and `left` are ordinary lag and shouldn't fail a build; they're a pull request waiting to
be written.

## Matching

Teams match groups **by name**, so an Okta group called `stream-checkout` reconciles the team with
that id. Directories rarely name groups that cleanly, so `--group-prefix eng-` strips a prefix
first — `eng-stream-checkout` matches `stream-checkout`.

People match **by email**, from `members[].contact`, case-insensitively and ignoring surrounding
whitespace. A member with no `contact` is reported as `unmatched` rather than assumed present or
absent — a guess either way would be worse than saying so.

An inactive account that nobody declares is *not* reported as a joiner. It's an old account, not a
new colleague.

## Read-only, and deliberately so

Nothing is written back to `teamapi.yml`. A reconciler that edited the file would put a second
write path on the thing the whole project treats as the source of truth — the same rule the
[Paperclip integration](paperclip.md) sets out. If you want this automated, have a scheduled job
open a **pull request**, so a joiner is reviewed like any other org change.

## Suggested loop

1. Give each team a directory group named after its id, or use `--group-prefix`.
2. Run `teamapi okta-drift` on a schedule, and as a required check.
3. Let `deactivated` fail the build. Turn `joined` and `left` into a pull request.
