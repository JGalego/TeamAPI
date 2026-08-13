---
"@jgalego/teamapi-core": minor
"@jgalego/teamapi": minor
---

Add severity overrides and expiring waivers for `teamapi gaps`, via a `teamapi.config.yml`.

Run the check against an org that has existed for years and it reports the whole accumulated
history at once — and a check that goes red on the day it's switched on gets switched back off.
`severity` re-grades a whole kind (including `off`), waivers exempt one specific finding with a
mandatory reason.

Waivers expire, because an exemption that doesn't is a deletion with extra steps, and a lapsed one
is reported as its own finding rather than silently turning a build red. Waivers matching nothing
are reported so the file doesn't accumulate dead exemptions, and an unknown gap kind is an error —
a typo that quietly does nothing while the org believes a rule is in force is worse than no config.
